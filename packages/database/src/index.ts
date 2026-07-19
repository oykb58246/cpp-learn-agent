import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type {
  AgentRun,
  AgentRunDetail,
  AgentConversation,
  AgentMessage,
  AchievementDefinition,
  BackgroundProfile,
  Approval,
  AppSettings,
  CursorStyle,
  DomainEvent,
  ErrorBookEntry,
  DiagnosticFailureKind,
  DiagnosticIncidentDetail,
  KnowledgeNode,
  LearnerAchievement,
  LearnerKnowledge,
  LearnerSummary,
  LearningEvent,
  ModelProfile,
  Project,
  ReviewItem,
  SnapshotManifest,
  TimelineEvent,
  ToolCall,
  ToolchainProfile,
  Workspace
} from '@cpp-pet/contracts'
import { h3Migrations } from './h3'
import { SqliteDatabase } from './sqlite'

const foundationSql = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, normalized_root TEXT NOT NULL UNIQUE,
  trust_state TEXT NOT NULL, created_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, removed_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, type TEXT NOT NULL,
  creation_mode TEXT NOT NULL, relative_root TEXT NOT NULL, problem_id TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, removed_at TEXT,
  UNIQUE(workspace_id, relative_root)
);
CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), label TEXT NOT NULL, reason TEXT NOT NULL,
  scope TEXT NOT NULL, manifest_path TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot_entries (
  snapshot_id TEXT NOT NULL REFERENCES file_snapshots(id) ON DELETE CASCADE, relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL, blob_hash TEXT NOT NULL, size INTEGER NOT NULL,
  PRIMARY KEY(snapshot_id, relative_path)
);
CREATE TABLE IF NOT EXISTS domain_events (
  event_id TEXT PRIMARY KEY, type TEXT NOT NULL, occurred_at TEXT NOT NULL, actor TEXT NOT NULL,
  project_id TEXT, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_project ON file_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON domain_events(occurred_at DESC);
`

export interface Migration { version: number; name: string; sql: string }
export interface StoredProblem {
  id: string
  statement: string
  constraints: string[]
  samples: Array<{ input: string; output: string }>
  createdAt: string
}
const foundationMigration: Migration = { version: 1, name: 'h1-foundation', sql: foundationSql }
const projectMetadataMigration: Migration = { version: 2, name: 'h1-user-problem-metadata', sql: `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY, statement TEXT NOT NULL, constraints_json TEXT NOT NULL, samples_json TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO users(id, nickname, created_at, updated_at) VALUES('local-user', 'C++ 学习者', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
` }
const toolchainMigration: Migration = { version: 3, name: 'h2-toolchain-profiles', sql: `
CREATE TABLE IF NOT EXISTS toolchain_profiles (
  id TEXT PRIMARY KEY, family TEXT NOT NULL, version TEXT NOT NULL, target_arch TEXT NOT NULL,
  compiler_path TEXT NOT NULL, debugger_path TEXT, environment_script TEXT, language_server_path TEXT,
  cmake_generator TEXT, compile_commands_path TEXT, capabilities_json TEXT NOT NULL,
  verified_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toolchain_profiles_updated ON toolchain_profiles(updated_at DESC);
` }
const migrationHash = (migration: Migration) => createHash('sha256').update(`${migration.version}:${migration.name}:${migration.sql}`).digest('hex')

export interface SnapshotRecord extends SnapshotManifest { manifestPath: string; blobHashes: Record<string, string> }
export interface AgentModelSessionRecord {
  runId: string
  protocol: string
  state: unknown
  updatedAt: string
}

export class AppDatabase {
  readonly db: SqliteDatabase
  readonly recoveryMode: boolean

  constructor(readonly filePath: string, additionalMigrations: Migration[] = []) {
    const migrations = [foundationMigration, projectMetadataMigration, toolchainMigration, ...h3Migrations, ...additionalMigrations]
    mkdirSync(dirname(filePath), { recursive: true })
    this.db = new SqliteDatabase(filePath)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    let recovery = false
    try {
      this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)')
      const migrationColumns = this.db.pragma('table_info(schema_migrations)') as Array<{ name: string }>
      if (!migrationColumns.some(column => column.name === 'checksum')) {
        this.db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT ''")
        for (const item of migrations) this.db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ? AND checksum = ?').run(migrationHash(item), item.version, '')
      }
      const applied = this.db.prepare('SELECT version, name, checksum FROM schema_migrations').all() as Array<{ version: number; name: string; checksum: string }>
      for (const record of applied) {
        const expected = migrations.find(item => item.version === record.version)
        if (!expected || record.name !== expected.name || record.checksum !== migrationHash(expected)) throw new Error(`Migration checksum mismatch at version ${record.version}`)
      }
      const pending = migrations.filter(item => !applied.some(record => record.version === item.version)).sort((a, b) => a.version - b.version)
      if (pending.length) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        if (existsSync(filePath) && statSync(filePath).size > 0) {
          const backupDir = resolve(dirname(filePath), '..', 'backups'); mkdirSync(backupDir, { recursive: true })
          copyFileSync(filePath, join(backupDir, `pre-migration-${Date.now()}.sqlite`))
        }
        this.db.transaction(() => {
          const insert = this.db.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES(?,?,?,?)')
          for (const item of pending) { this.db.exec(item.sql); insert.run(item.version, item.name, migrationHash(item), new Date().toISOString()) }
        })()
        const check = this.db.pragma('quick_check', { simple: true }) as string
        if (check !== 'ok') throw new Error(`SQLite quick_check failed: ${check}`)
      }
    } catch {
      recovery = true
    }
    this.recoveryMode = recovery
    if (!recovery) this.recoverInterruptedMessages(new Date().toISOString())
  }

  close(): void { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close() }

  transaction<T>(action: () => T): T {
    this.ensureWritable()
    return this.db.transaction(action)()
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app') as { value_json: string } | undefined
    if (!row) return {
      theme: 'system',
      sidebarWidth: 260,
      inspectorWidth: 320,
      bottomPanelHeight: 190,
      cursorStyle: 'mascot',
      onboardingCompleted: false,
      onboardingStatus: 'pending',
      onboardingReminderDismissed: false,
      productTourStatus: 'pending',
      productTourStep: 0,
      productTourWelcomeSeen: false
    }
    const saved = JSON.parse(row.value_json) as Partial<AppSettings> & { customCursor?: boolean }
    const onboardingCompleted = typeof saved.onboardingCompleted === 'boolean' ? saved.onboardingCompleted : true
    const onboardingStatus = saved.onboardingStatus === 'pending' || saved.onboardingStatus === 'completed' || saved.onboardingStatus === 'skipped'
      ? saved.onboardingStatus
      : onboardingCompleted ? 'completed' : 'pending'
    const productTourStatus = saved.productTourStatus === 'in-progress'
      || saved.productTourStatus === 'completed'
      || saved.productTourStatus === 'dismissed'
      ? saved.productTourStatus
      : 'pending'
    const productTourStep = Number.isInteger(saved.productTourStep) && Number(saved.productTourStep) >= 0
      ? Number(saved.productTourStep)
      : 0
    const productTourWelcomeSeen = saved.productTourWelcomeSeen === true
    const cursorStyle = resolveCursorStyle(saved)
    return {
      theme: 'system',
      sidebarWidth: 260,
      inspectorWidth: 320,
      bottomPanelHeight: 190,
      onboardingCompleted,
      onboardingReminderDismissed: false,
      ...saved,
      cursorStyle,
      onboardingStatus,
      productTourStatus,
      productTourStep,
      productTourWelcomeSeen
    }
  }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.ensureWritable()
    const next = { ...this.getSettings(), ...patch }
    if (patch.cursorStyle) next.cursorStyle = patch.cursorStyle
    this.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify(next))
    return next
  }
  setActiveToolchain(id?: string): AppSettings {
    this.ensureWritable()
    const next = { ...this.getSettings() }
    if (id) next.activeToolchainId = id
    else delete next.activeToolchainId
    this.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify(next))
    return next
  }
  listToolchainProfiles(): ToolchainProfile[] {
    const rows = this.db.prepare('SELECT * FROM toolchain_profiles ORDER BY updated_at DESC').all() as any[]
    return rows.map(mapToolchainProfile)
  }
  getToolchainProfile(id: string): ToolchainProfile | undefined {
    const row = this.db.prepare('SELECT * FROM toolchain_profiles WHERE id = ?').get(id) as any
    return row ? mapToolchainProfile(row) : undefined
  }
  saveToolchainProfile(profile: ToolchainProfile): ToolchainProfile {
    this.ensureWritable()
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO toolchain_profiles(
      id,family,version,target_arch,compiler_path,debugger_path,environment_script,language_server_path,
      cmake_generator,compile_commands_path,capabilities_json,verified_at,created_at,updated_at
    ) VALUES(
      @id,@family,@version,@targetArch,@compilerPath,@debuggerPath,@environmentScript,@languageServerPath,
      @cmakeGenerator,@compileCommandsPath,@capabilitiesJson,@verifiedAt,@createdAt,@updatedAt
    ) ON CONFLICT(id) DO UPDATE SET
      family=excluded.family,version=excluded.version,target_arch=excluded.target_arch,
      compiler_path=excluded.compiler_path,debugger_path=excluded.debugger_path,
      environment_script=excluded.environment_script,language_server_path=excluded.language_server_path,
      cmake_generator=excluded.cmake_generator,compile_commands_path=excluded.compile_commands_path,
      capabilities_json=excluded.capabilities_json,verified_at=excluded.verified_at,updated_at=excluded.updated_at`)
      .run({
        ...profile,
        debuggerPath: profile.debuggerPath ?? null,
        environmentScript: profile.environmentScript ?? null,
        languageServerPath: profile.languageServerPath ?? null,
        cmakeGenerator: profile.cmakeGenerator ?? null,
        compileCommandsPath: profile.compileCommandsPath ?? null,
        capabilitiesJson: JSON.stringify(profile.capabilities),
        createdAt: now,
        updatedAt: now
      })
    return profile
  }
  removeToolchainProfile(id: string): void {
    this.ensureWritable()
    this.db.prepare('DELETE FROM toolchain_profiles WHERE id = ?').run(id)
  }
  listWorkspaces(): Workspace[] {
    return (this.db.prepare('SELECT * FROM workspaces WHERE removed_at IS NULL ORDER BY last_opened_at DESC').all() as any[]).map(mapWorkspace)
  }
  getWorkspace(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ? AND removed_at IS NULL').get(id) as any
    return row ? mapWorkspace(row) : undefined
  }
  upsertWorkspace(workspace: Workspace): Workspace {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO workspaces(id,name,root_path,normalized_root,trust_state,created_at,last_opened_at,removed_at)
      VALUES(@id,@name,@rootPath,@normalizedRoot,@trustState,@createdAt,@lastOpenedAt,NULL)
      ON CONFLICT(normalized_root) DO UPDATE SET name=excluded.name,last_opened_at=excluded.last_opened_at,removed_at=NULL`).run({ ...workspace, normalizedRoot: normalizeRoot(workspace.rootPath) })
    return this.db.prepare('SELECT * FROM workspaces WHERE normalized_root = ?').get(normalizeRoot(workspace.rootPath)) ?
      mapWorkspace(this.db.prepare('SELECT * FROM workspaces WHERE normalized_root = ?').get(normalizeRoot(workspace.rootPath)) as any) : workspace
  }
  setWorkspaceTrust(id: string, state: Workspace['trustState']): Workspace {
    this.ensureWritable()
    this.db.prepare('UPDATE workspaces SET trust_state = ? WHERE id = ?').run(state, id)
    const item = this.getWorkspace(id); if (!item) throw new Error('Workspace not found'); return item
  }
  touchWorkspace(id: string): Workspace { if (!this.recoveryMode) this.db.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id); const item = this.getWorkspace(id); if (!item) throw new Error('Workspace not found'); return item }
  removeWorkspace(id: string): void { this.ensureWritable(); this.db.prepare('UPDATE workspaces SET removed_at = ? WHERE id = ?').run(new Date().toISOString(), id) }

  listProjects(workspaceId?: string): Project[] {
    const rows = workspaceId
      ? this.db.prepare('SELECT * FROM projects WHERE removed_at IS NULL AND workspace_id = ? ORDER BY last_opened_at DESC').all(workspaceId)
      : this.db.prepare('SELECT * FROM projects WHERE removed_at IS NULL ORDER BY last_opened_at DESC').all()
    return (rows as any[]).map(mapProject)
  }
  getProject(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ? AND removed_at IS NULL').get(id) as any
    return row ? mapProject(row) : undefined
  }
  getProblem(id: string): StoredProblem | undefined {
    const row = this.db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as any
    return row ? {
      id: row.id,
      statement: row.statement,
      constraints: JSON.parse(row.constraints_json),
      samples: JSON.parse(row.samples_json),
      createdAt: row.created_at
    } : undefined
  }
  saveProject(project: Project, problem?: { id: string; statement: string; constraints: string[]; samples: Array<{ input: string; output: string }>; createdAt: string }): Project {
    this.ensureWritable()
    this.db.transaction(() => {
      // 释放同路径已软删除记录占用的 UNIQUE 槽位（保留行与快照外键）
      this.db.prepare(`UPDATE projects
        SET relative_root = relative_root || '::__legacy__' || id
        WHERE workspace_id = ? AND relative_root = ? AND removed_at IS NOT NULL`)
        .run(project.workspaceId, project.relativeRoot)
      if (problem) this.db.prepare('INSERT INTO problems(id,statement,constraints_json,samples_json,created_at) VALUES(@id,@statement,@constraintsJson,@samplesJson,@createdAt)').run({ ...problem, constraintsJson: JSON.stringify(problem.constraints), samplesJson: JSON.stringify(problem.samples) })
      this.db.prepare(`INSERT INTO projects(id,workspace_id,name,type,creation_mode,relative_root,problem_id,created_at,updated_at,last_opened_at)
        VALUES(@id,@workspaceId,@name,@type,@creationMode,@relativeRoot,@problemId,@createdAt,@updatedAt,@lastOpenedAt)`).run({ ...project, problemId: project.problemId ?? null })
    })()
    return project
  }
  touchProject(id: string): Project { if (!this.recoveryMode) { const now = new Date().toISOString(); this.db.prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?').run(now, now, id) }; const p = this.getProject(id); if (!p) throw new Error('Project not found'); return p }
  renameProject(id: string, name: string): Project {
    this.ensureWritable()
    const now = new Date().toISOString()
    this.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL').run(name, now, id)
    const project = this.getProject(id)
    if (!project) throw new Error('Project not found')
    return project
  }
  removeProject(id: string): void {
    this.ensureWritable()
    const row = this.db.prepare('SELECT relative_root FROM projects WHERE id = ?').get(id) as { relative_root: string } | undefined
    if (!row) return
    // 释放 UNIQUE(workspace_id, relative_root)，避免软删除后无法用同名再建
    const tombstoneRoot = `${row.relative_root}::__removed__${id}`
    this.db.prepare('UPDATE projects SET removed_at = ?, relative_root = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), tombstoneRoot, new Date().toISOString(), id)
  }

  saveSnapshot(snapshot: SnapshotRecord): void {
    this.ensureWritable()
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO file_snapshots(id,project_id,label,reason,scope,manifest_path,created_at) VALUES(@id,@projectId,@label,@reason,@scope,@manifestPath,@createdAt)').run(snapshot)
      const stmt = this.db.prepare('INSERT INTO snapshot_entries(snapshot_id,relative_path,content_hash,blob_hash,size) VALUES(?,?,?,?,?)')
      for (const entry of snapshot.entries) stmt.run(snapshot.id, entry.relativePath, entry.contentHash, snapshot.blobHashes[entry.relativePath], entry.size)
    })()
  }
  listSnapshots(projectId: string): SnapshotRecord[] {
    const rows = this.db.prepare('SELECT * FROM file_snapshots WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]
    return rows.map(row => this.snapshotFromRow(row))
  }
  getSnapshot(id: string): SnapshotRecord | undefined {
    const row = this.db.prepare('SELECT * FROM file_snapshots WHERE id = ?').get(id) as any
    return row ? this.snapshotFromRow(row) : undefined
  }
  removeSnapshot(id: string): void { this.ensureWritable(); this.db.prepare('DELETE FROM file_snapshots WHERE id = ?').run(id) }
  blobReferenceCount(blobHash: string): number { return (this.db.prepare('SELECT COUNT(*) AS count FROM snapshot_entries WHERE blob_hash = ?').get(blobHash) as { count: number }).count }
  private snapshotFromRow(row: any): SnapshotRecord {
    const entries = this.db.prepare('SELECT * FROM snapshot_entries WHERE snapshot_id = ? ORDER BY relative_path').all(row.id) as any[]
    return { id: row.id, projectId: row.project_id, label: row.label, reason: row.reason, scope: row.scope, manifestPath: row.manifest_path, createdAt: row.created_at,
      entries: entries.map(e => ({ relativePath: e.relative_path, contentHash: e.content_hash, size: e.size })),
      blobHashes: Object.fromEntries(entries.map(e => [e.relative_path, e.blob_hash])) }
  }
  addEvent(event: DomainEvent): void {
    this.ensureWritable()
    this.db.prepare('INSERT INTO domain_events(event_id,type,occurred_at,actor,project_id,payload_json) VALUES(?,?,?,?,?,?)')
      .run(event.eventId, event.type, event.occurredAt, event.actor, event.projectId ?? null, JSON.stringify(event.payload))
  }
  listEvents(limit = 20): DomainEvent[] {
    const rows = this.db.prepare('SELECT * FROM domain_events ORDER BY occurred_at DESC LIMIT ?').all(limit) as Array<{ event_id: string; type: string; occurred_at: string; actor: DomainEvent['actor']; project_id: string | null; payload_json: string }>
    return rows.map(row => ({ eventId: row.event_id, type: row.type, version: 1, occurredAt: row.occurred_at, actor: row.actor, ...(row.project_id ? { projectId: row.project_id } : {}), payload: JSON.parse(row.payload_json) as unknown }))
  }

  createAgentRun(run: AgentRun): AgentRun {
    this.ensureWritable()
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO agent_runs(
        id,request_id,source,mode,message,project_id,active_file,conversation_id,assistant_message_id,status,intent,plan_summary,response,
        validation_summary,error_code,error_message,steps_json,pending_approval_json,pending_clarification_json,created_at,updated_at,completed_at
      ) VALUES(
        @id,@requestId,@source,@mode,@message,@projectId,@activeFile,@conversationId,@assistantMessageId,@status,@intent,@planSummary,@response,
        @validationSummary,@errorCode,@errorMessage,@stepsJson,@pendingApprovalJson,@pendingClarificationJson,@createdAt,@updatedAt,@completedAt
      )`).run(agentRunParams(run))
      this.replaceAgentSteps(run)
      return run
    })
  }

  updateAgentRun(run: AgentRun): AgentRun {
    this.ensureWritable()
    return this.transaction(() => {
      const result = this.db.prepare(`UPDATE agent_runs SET
        source=@source,mode=@mode,message=@message,project_id=@projectId,active_file=@activeFile,
        conversation_id=@conversationId,assistant_message_id=@assistantMessageId,status=@status,
        intent=@intent,plan_summary=@planSummary,response=@response,validation_summary=@validationSummary,
        error_code=@errorCode,error_message=@errorMessage,steps_json=@stepsJson,
        pending_approval_json=@pendingApprovalJson,pending_clarification_json=@pendingClarificationJson,
        updated_at=@updatedAt,completed_at=@completedAt
        WHERE id=@id`).run(agentRunParams(run))
      if (result.changes === 0) throw new Error('Agent run not found')
      this.replaceAgentSteps(run)
      return run
    })
  }

  saveAgentCheckpoint(run: AgentRun, session?: AgentModelSessionRecord): AgentRun {
    this.ensureWritable()
    return this.transaction(() => {
      this.updateAgentRun(run)
      if (session) this.saveAgentModelSession(session)
      else this.deleteAgentModelSession(run.id)
      return run
    })
  }

  getAgentRun(id: string): AgentRunDetail | undefined {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as any
    if (!row) return undefined
    const timeline = (this.db.prepare('SELECT * FROM timeline_events WHERE run_id = ? ORDER BY sequence').all(id) as any[]).map(mapTimelineEvent)
    const approvals = (this.db.prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at').all(id) as any[]).map(mapApproval)
    const toolCalls = (this.db.prepare('SELECT * FROM tool_calls WHERE run_id = ? ORDER BY started_at, id').all(id) as any[]).map(mapToolCall)
    return { ...mapAgentRun(row), timeline, approvals, toolCalls }
  }

  listAgentRuns(input: { status?: AgentRun['status']; projectId?: string; limit?: number } = {}): AgentRun[] {
    const where: string[] = []
    const params: unknown[] = []
    if (input.status) { where.push('status = ?'); params.push(input.status) }
    if (input.projectId) { where.push('project_id = ?'); params.push(input.projectId) }
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
    const rows = this.db.prepare(`SELECT * FROM agent_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`).all(...params, limit) as any[]
    return rows.map(mapAgentRun)
  }

  recoverInterruptedAgentRuns(recoveredAt = new Date().toISOString()): AgentRun[] {
    this.ensureWritable()
    return this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT * FROM agent_runs
        WHERE status NOT IN ('completed','failed','cancelled')
          AND NOT (
            status IN ('waiting-model-approval','waiting-approval','waiting-input')
            AND EXISTS (SELECT 1 FROM agent_model_sessions session WHERE session.run_id = agent_runs.id)
          )
        ORDER BY updated_at`).all() as any[]
      const recovered: AgentRun[] = []
      const update = this.db.prepare(`UPDATE agent_runs SET status=@status,response=@response,error_code=@errorCode,
        error_message=@errorMessage,steps_json=@stepsJson,pending_approval_json=NULL,updated_at=@updatedAt,completed_at=@completedAt WHERE id=@id`)
      const expireApprovals = this.db.prepare("UPDATE approvals SET status='expired',decision_reason=?,decided_at=? WHERE run_id=? AND status='pending'")
      const nextSequence = this.db.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 sequence FROM timeline_events WHERE run_id = ?')
      const insertTimeline = this.db.prepare(`INSERT INTO timeline_events(id,run_id,sequence,kind,status,title,summary,occurred_at,step_id,data_json)
        VALUES(@id,@runId,@sequence,'cancelled','cancelled',@title,@summary,@occurredAt,NULL,@dataJson)`)
      for (const row of rows) {
        const original = mapAgentRun(row)
        const { pendingApproval: _pendingApproval, ...originalWithoutPendingApproval } = original
        const run: AgentRun = {
          ...originalWithoutPendingApproval,
          status: 'cancelled',
          response: '应用在任务执行期间关闭；该记录已恢复为只读，不会自动重放操作。',
          errorCode: 'RUN_INTERRUPTED',
          errorMessage: '应用重启中断了未完成任务。',
          steps: original.steps.map(step => ['completed', 'failed', 'cancelled'].includes(step.status)
            ? step
            : { ...step, status: 'cancelled', finishedAt: recoveredAt }),
          updatedAt: recoveredAt,
          completedAt: recoveredAt
        }
        update.run({
          id: run.id, status: run.status, response: run.response, errorCode: run.errorCode, errorMessage: run.errorMessage,
          stepsJson: JSON.stringify(run.steps), updatedAt: recoveredAt, completedAt: recoveredAt
        })
        this.replaceAgentSteps(run)
        expireApprovals.run('应用重启后审批已失效。', recoveredAt, run.id)
        const sequence = (nextSequence.get(run.id) as { sequence: number }).sequence
        insertTimeline.run({
          id: randomUUID(), runId: run.id, sequence, title: '任务在重启后恢复为只读记录',
          summary: run.response, occurredAt: recoveredAt, dataJson: JSON.stringify({ errorCode: 'RUN_INTERRUPTED' })
        })
        recovered.push(run)
      }
      return recovered
    })()
  }

  saveAgentModelSession(session: AgentModelSessionRecord): AgentModelSessionRecord {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO agent_model_sessions(run_id,protocol,state_json,updated_at)
      VALUES(@runId,@protocol,@stateJson,@updatedAt)
      ON CONFLICT(run_id) DO UPDATE SET protocol=excluded.protocol,state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run({ ...session, stateJson: JSON.stringify(session.state) })
    return session
  }

  getAgentModelSession(runId: string): AgentModelSessionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM agent_model_sessions WHERE run_id = ?').get(runId) as any
    return row ? mapAgentModelSession(row) : undefined
  }

  listAgentModelSessions(): AgentModelSessionRecord[] {
    return (this.db.prepare('SELECT * FROM agent_model_sessions ORDER BY updated_at, run_id').all() as any[])
      .map(mapAgentModelSession)
  }

  deleteAgentModelSession(runId: string): void {
    this.ensureWritable()
    this.db.prepare('DELETE FROM agent_model_sessions WHERE run_id = ?').run(runId)
  }

  appendTimeline(event: TimelineEvent): TimelineEvent {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO timeline_events(id,run_id,sequence,kind,status,title,summary,occurred_at,step_id,data_json)
      VALUES(@id,@runId,@sequence,@kind,@status,@title,@summary,@occurredAt,@stepId,@dataJson)`).run({
      ...event,
      stepId: event.stepId ?? null,
      dataJson: event.data ? JSON.stringify(event.data) : null
    })
    return event
  }

  saveApproval(approval: Approval): Approval {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO approvals(
      id,run_id,step_id,tool_name,risk,title,description,parameter_summary_json,side_effects_json,
      diff_text,status,decision_reason,created_at,decided_at
    ) VALUES(
      @id,@runId,@stepId,@toolName,@risk,@title,@description,@parameterSummaryJson,@sideEffectsJson,
      @diff,@status,@decisionReason,@createdAt,@decidedAt
    ) ON CONFLICT(id) DO UPDATE SET diff_text=excluded.diff_text,status=excluded.status,
      decision_reason=excluded.decision_reason,decided_at=excluded.decided_at`).run({
      ...approval,
      parameterSummaryJson: JSON.stringify(approval.parameterSummary),
      sideEffectsJson: JSON.stringify(approval.sideEffects),
      diff: approval.diff ?? null,
      decisionReason: approval.decisionReason ?? null,
      decidedAt: approval.decidedAt ?? null
    })
    return approval
  }

  saveToolCall(call: ToolCall): ToolCall {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO tool_calls(
      id,run_id,step_id,server_name,tool_name,risk,parameter_summary_json,result_json,status,
      started_at,finished_at,duration_ms,error_code
    ) VALUES(
      @id,@runId,@stepId,@serverName,@toolName,@risk,@parameterSummaryJson,@resultJson,@status,
      @startedAt,@finishedAt,@durationMs,@errorCode
    ) ON CONFLICT(id) DO UPDATE SET result_json=excluded.result_json,status=excluded.status,
      finished_at=excluded.finished_at,duration_ms=excluded.duration_ms,error_code=excluded.error_code`).run({
      ...call,
      parameterSummaryJson: JSON.stringify(call.parameterSummary),
      resultJson: call.result ? JSON.stringify(call.result) : null,
      finishedAt: call.finishedAt ?? null,
      durationMs: call.durationMs ?? null,
      errorCode: call.errorCode ?? null
    })
    return call
  }

  seedKnowledge(nodes: KnowledgeNode[]): void {
    this.ensureWritable()
    this.db.transaction(() => {
      const insertNode = this.db.prepare(`INSERT INTO knowledge_nodes(id,title,description,category,difficulty,prerequisites_json,tags_json)
        VALUES(@id,@title,@description,@category,@difficulty,@prerequisitesJson,@tagsJson)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,
        difficulty=excluded.difficulty,prerequisites_json=excluded.prerequisites_json,tags_json=excluded.tags_json`)
      for (const node of nodes) insertNode.run({ ...node, prerequisitesJson: JSON.stringify(node.prerequisites), tagsJson: JSON.stringify(node.tags) })
      const insertEdge = this.db.prepare('INSERT OR IGNORE INTO knowledge_edges(prerequisite_id,concept_id) VALUES(?,?)')
      for (const node of nodes) for (const prerequisite of node.prerequisites) insertEdge.run(prerequisite, node.id)
    })()
  }

  listKnowledgeNodes(): KnowledgeNode[] {
    return (this.db.prepare('SELECT * FROM knowledge_nodes ORDER BY id').all() as any[]).map(mapKnowledgeNode)
  }

  upsertLearnerKnowledge(state: LearnerKnowledge): LearnerKnowledge {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO learner_knowledge(user_id,concept_id,status,confidence,verified_at,last_evidence_id,updated_at)
      VALUES(@userId,@conceptId,@status,@confidence,@verifiedAt,@lastEvidenceId,@updatedAt)
      ON CONFLICT(user_id,concept_id) DO UPDATE SET status=excluded.status,confidence=excluded.confidence,
      verified_at=excluded.verified_at,last_evidence_id=excluded.last_evidence_id,updated_at=excluded.updated_at`).run({
      ...state,
      verifiedAt: state.verifiedAt ?? null,
      lastEvidenceId: state.lastEvidenceId ?? null
    })
    return state
  }

  listLearnerKnowledge(userId: string): LearnerKnowledge[] {
    return (this.db.prepare('SELECT * FROM learner_knowledge WHERE user_id = ? ORDER BY concept_id').all(userId) as any[]).map(mapLearnerKnowledge)
  }

  saveBackgroundProfile(profile: BackgroundProfile): BackgroundProfile {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO background_profiles(
      user_id,onboarding_completed,starting_point,studied_concept_ids_json,focus_concept_ids_json,updated_at
    ) VALUES(@userId,@onboardingCompleted,@startingPoint,@studiedConceptIdsJson,@focusConceptIdsJson,@updatedAt)
    ON CONFLICT(user_id) DO UPDATE SET onboarding_completed=excluded.onboarding_completed,
      starting_point=excluded.starting_point,studied_concept_ids_json=excluded.studied_concept_ids_json,
      focus_concept_ids_json=excluded.focus_concept_ids_json,updated_at=excluded.updated_at`).run({
      ...profile,
      onboardingCompleted: profile.onboardingCompleted ? 1 : 0,
      studiedConceptIdsJson: JSON.stringify([...new Set(profile.studiedConceptIds)]),
      focusConceptIdsJson: JSON.stringify([...new Set(profile.focusConceptIds)])
    })
    return profile
  }

  getBackgroundProfile(userId: string): BackgroundProfile | undefined {
    const row = this.db.prepare('SELECT * FROM background_profiles WHERE user_id = ?').get(userId) as any
    return row ? mapBackgroundProfile(row) : undefined
  }

  saveErrorBookEntry(entry: ErrorBookEntry): ErrorBookEntry {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO error_book_entries(
      id,user_id,project_id,relative_path,category,title,evidence,concept_ids_json,status,occurrences,
      first_seen_at,last_seen_at,resolved_at,next_review_at
    ) VALUES(
      @id,@userId,@projectId,@relativePath,@category,@title,@evidence,@conceptIdsJson,@status,@occurrences,
      @firstSeenAt,@lastSeenAt,@resolvedAt,@nextReviewAt
    ) ON CONFLICT(id) DO UPDATE SET title=excluded.title,evidence=excluded.evidence,status=excluded.status,
      occurrences=excluded.occurrences,last_seen_at=excluded.last_seen_at,resolved_at=excluded.resolved_at,
      next_review_at=excluded.next_review_at`).run({
      ...entry,
      projectId: entry.projectId ?? null,
      relativePath: entry.relativePath ?? null,
      conceptIdsJson: JSON.stringify(entry.conceptIds),
      resolvedAt: entry.resolvedAt ?? null,
      nextReviewAt: entry.nextReviewAt ?? null
    })
    return entry
  }

  listErrorBookEntries(userId: string, status?: ErrorBookEntry['status']): ErrorBookEntry[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM error_book_entries WHERE user_id = ? AND status = ? ORDER BY last_seen_at DESC').all(userId, status)
      : this.db.prepare('SELECT * FROM error_book_entries WHERE user_id = ? ORDER BY last_seen_at DESC').all(userId)
    return (rows as any[]).map(mapErrorBookEntry)
  }

  saveReviewItem(item: ReviewItem): ReviewItem {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO review_items(
      id,user_id,error_book_entry_id,concept_id,prompt,expected_evidence,interval_index,due_at,status,completed_at
    ) VALUES(
      @id,@userId,@errorBookEntryId,@conceptId,@prompt,@expectedEvidence,@intervalIndex,@dueAt,@status,@completedAt
    ) ON CONFLICT(id) DO UPDATE SET interval_index=excluded.interval_index,due_at=excluded.due_at,
      status=excluded.status,completed_at=excluded.completed_at`).run({
      ...item,
      errorBookEntryId: item.errorBookEntryId ?? null,
      completedAt: item.completedAt ?? null
    })
    return item
  }

  listReviewItems(userId: string, dueOnly = false, now = new Date()): ReviewItem[] {
    const rows = dueOnly
      ? this.db.prepare("SELECT * FROM review_items WHERE user_id = ? AND status = 'pending' AND due_at <= ? ORDER BY due_at").all(userId, now.toISOString())
      : this.db.prepare('SELECT * FROM review_items WHERE user_id = ? ORDER BY due_at').all(userId)
    return (rows as any[]).map(mapReviewItem)
  }

  applyLearningEvent(event: LearningEvent): boolean {
    this.ensureWritable()
    return this.db.transaction(() => {
      const inserted = this.db.prepare(`INSERT OR IGNORE INTO learning_events(
        id,source_event_id,user_id,type,concept_ids_json,xp,evidence_json,occurred_at
      ) VALUES(@id,@sourceEventId,@userId,@type,@conceptIdsJson,@xp,@evidenceJson,@occurredAt)`).run({
        ...event,
        conceptIdsJson: JSON.stringify(event.conceptIds),
        evidenceJson: JSON.stringify(event.evidence)
      })
      if (inserted.changes === 0) return false
      this.db.prepare(`INSERT INTO learner_progress(user_id,xp,updated_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET xp=xp+excluded.xp,updated_at=excluded.updated_at`)
        .run(event.userId, event.xp, event.occurredAt)
      return true
    })()
  }

  listLearningEvents(userId: string, limit = 200): LearningEvent[] {
    return (this.db.prepare('SELECT * FROM learning_events WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?').all(userId, Math.max(1, Math.min(limit, 1_000))) as any[]).map(mapLearningEvent)
  }

  seedAchievementDefinitions(definitions: AchievementDefinition[]): void {
    this.ensureWritable()
    const statement = this.db.prepare(`INSERT INTO achievement_definitions(id,title,description,icon,rule_json,xp_reward)
      VALUES(@id,@title,@description,@icon,@ruleJson,@xpReward)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,icon=excluded.icon,
      rule_json=excluded.rule_json,xp_reward=excluded.xp_reward`)
    this.db.transaction(() => {
      for (const item of definitions) statement.run({ ...item, ruleJson: JSON.stringify(item.rule) })
    })()
  }

  listLearnerAchievements(userId: string): LearnerAchievement[] {
    return (this.db.prepare('SELECT * FROM learner_achievements WHERE user_id = ? ORDER BY unlocked_at DESC').all(userId) as any[]).map(mapLearnerAchievement)
  }

  awardAchievement(achievement: LearnerAchievement): boolean {
    this.ensureWritable()
    const result = this.db.prepare(`INSERT OR IGNORE INTO learner_achievements(user_id,achievement_id,source_event_id,unlocked_at)
      VALUES(@userId,@achievementId,@sourceEventId,@unlockedAt)`).run(achievement)
    return result.changes > 0
  }

  getLearnerSummary(userId: string): LearnerSummary {
    const progress = this.db.prepare('SELECT xp FROM learner_progress WHERE user_id = ?').get(userId) as { xp: number } | undefined
    const xp = progress?.xp ?? 0
    const verifiedConcepts = (this.db.prepare("SELECT COUNT(*) count FROM learner_knowledge WHERE user_id = ? AND status = 'verified'").get(userId) as { count: number }).count
    const learningConcepts = (this.db.prepare("SELECT COUNT(*) count FROM learner_knowledge WHERE user_id = ? AND status IN ('learning','self-claimed')").get(userId) as { count: number }).count
    const openErrors = (this.db.prepare("SELECT COUNT(*) count FROM error_book_entries WHERE user_id = ? AND status != 'resolved'").get(userId) as { count: number }).count
    const dueReviews = (this.db.prepare("SELECT COUNT(*) count FROM review_items WHERE user_id = ? AND status = 'pending' AND due_at <= ?").get(userId, new Date().toISOString()) as { count: number }).count
    const achievements = (this.db.prepare('SELECT * FROM learner_achievements WHERE user_id = ? ORDER BY unlocked_at DESC').all(userId) as any[]).map(mapLearnerAchievement)
    const recentEvents = (this.db.prepare('SELECT * FROM learning_events WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 20').all(userId) as any[]).map(mapLearningEvent)
    return {
      userId,
      xp,
      level: Math.floor(xp / 100) + 1,
      growthStage: xp >= 1_000 ? 4 : xp >= 500 ? 3 : xp >= 200 ? 2 : 1,
      verifiedConcepts,
      learningConcepts,
      openErrors,
      dueReviews,
      achievements,
      recentEvents
    }
  }

  saveModelProfile(profile: ModelProfile): ModelProfile {
    return this.transaction(() => {
      if (profile.enabled) {
        this.db.prepare('UPDATE model_profiles SET enabled = 0 WHERE id <> ?').run(profile.id)
      }
      this.db.prepare(`INSERT INTO model_profiles(id,name,base_url,model,enabled,timeout_ms,api_key_configured,created_at,updated_at)
        VALUES(@id,@name,@baseUrl,@model,@enabled,@timeoutMs,@apiKeyConfigured,@createdAt,@updatedAt)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,model=excluded.model,
        enabled=excluded.enabled,timeout_ms=excluded.timeout_ms,api_key_configured=excluded.api_key_configured,
        updated_at=excluded.updated_at`).run({
        ...profile,
        enabled: profile.enabled ? 1 : 0,
        apiKeyConfigured: profile.apiKeyConfigured ? 1 : 0
      })
      return profile
    })
  }

  listModelProfiles(): ModelProfile[] {
    return (this.db.prepare('SELECT * FROM model_profiles ORDER BY updated_at DESC').all() as any[]).map(mapModelProfile)
  }

  getModelProfile(id: string): ModelProfile | undefined {
    const row = this.db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as any
    return row ? mapModelProfile(row) : undefined
  }

  removeModelProfile(id: string): void {
    this.ensureWritable()
    this.db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id)
  }

  saveDiagnosticIncident(incident: DiagnosticIncidentDetail): DiagnosticIncidentDetail {
    this.ensureWritable()
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE diagnostic_incidents SET status='superseded',updated_at=?
        WHERE project_id=? AND target_key=? AND operation=? AND status='active'`)
        .run(incident.updatedAt, incident.projectId, incident.targetKey, incident.operation)
      this.db.prepare(`INSERT INTO diagnostic_incidents(
        id,project_id,attempt_id,target_key,operation,failure_kinds_json,status,acknowledged_at,created_at,updated_at,resolved_at
      ) VALUES(@id,@projectId,@attemptId,@targetKey,@operation,@failureKindsJson,@status,@acknowledgedAt,@createdAt,@updatedAt,@resolvedAt)`).run({
        ...incident,
        failureKindsJson: JSON.stringify(incident.failureKinds),
        acknowledgedAt: incident.acknowledgedAt ?? null,
        resolvedAt: incident.resolvedAt ?? null
      })
      const insertGroup = this.db.prepare(`INSERT INTO diagnostic_groups(
        id,incident_id,fingerprint,source,code,failure_kind,severity,title,normalized_template,occurrence_count,created_at
      ) VALUES(@id,@incidentId,@fingerprint,@source,@code,@failureKind,@severity,@title,@normalizedTemplate,@occurrenceCount,@createdAt)`)
      const insertOccurrence = this.db.prepare(`INSERT INTO diagnostic_occurrences(
        id,group_id,file,line,column_number,end_line,end_column,raw_message,normalized_message
      ) VALUES(@id,@groupId,@file,@line,@column,@endLine,@endColumn,@rawMessage,@normalizedMessage)`)
      for (const group of incident.groups) {
        insertGroup.run({ ...group, code: group.code ?? null })
        for (const occurrence of group.occurrences) insertOccurrence.run({
          ...occurrence,
          file: occurrence.file ?? null,
          line: occurrence.line ?? null,
          column: occurrence.column ?? null,
          endLine: occurrence.endLine ?? null,
          endColumn: occurrence.endColumn ?? null
        })
      }
      return incident
    })()
  }

  listActiveDiagnosticIncidents(projectId: string): DiagnosticIncidentDetail[] {
    const rows = this.db.prepare("SELECT * FROM diagnostic_incidents WHERE project_id=? AND status='active' ORDER BY updated_at DESC").all(projectId) as any[]
    return rows.map(row => this.mapDiagnosticIncident(row))
  }

  acknowledgeDiagnosticIncidents(projectId: string, ids: string[], at: string): void {
    this.ensureWritable()
    const update = this.db.prepare("UPDATE diagnostic_incidents SET acknowledged_at=?,updated_at=? WHERE id=? AND project_id=? AND status='active'")
    this.db.transaction(() => { for (const id of ids) update.run(at, at, id, projectId) })()
  }

  resolveDiagnosticIncidents(projectId: string, targetKey: string, kinds: DiagnosticFailureKind[], at: string): void {
    this.ensureWritable()
    const rows = this.db.prepare("SELECT id,failure_kinds_json FROM diagnostic_incidents WHERE project_id=? AND target_key=? AND status='active'")
      .all(projectId, targetKey) as Array<{ id: string; failure_kinds_json: string }>
    const update = this.db.prepare("UPDATE diagnostic_incidents SET status='resolved',resolved_at=?,updated_at=? WHERE id=?")
    this.db.transaction(() => {
      for (const row of rows) {
        const stored = JSON.parse(row.failure_kinds_json) as DiagnosticFailureKind[]
        if (stored.some(kind => kinds.includes(kind))) update.run(at, at, row.id)
      }
    })()
  }

  createConversation(conversation: AgentConversation): AgentConversation {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO agent_conversations(id,project_id,title,status,created_at,updated_at)
      VALUES(@id,@projectId,@title,@status,@createdAt,@updatedAt)`).run(conversation)
    return conversation
  }

  listConversations(projectId: string): AgentConversation[] {
    return (this.db.prepare("SELECT * FROM agent_conversations WHERE project_id=? AND status='active' ORDER BY updated_at DESC").all(projectId) as any[])
      .map(mapAgentConversation)
  }

  updateConversation(conversation: AgentConversation): AgentConversation {
    this.ensureWritable()
    const result = this.db.prepare(`UPDATE agent_conversations SET title=?,status=?,updated_at=? WHERE id=? AND project_id=?`)
      .run(conversation.title, conversation.status, conversation.updatedAt, conversation.id, conversation.projectId)
    if (!result.changes) throw new Error('Conversation not found')
    return conversation
  }

  archiveConversation(projectId: string, conversationId: string): AgentConversation {
    this.ensureWritable()
    const now = new Date().toISOString()
    const result = this.db.prepare("UPDATE agent_conversations SET status='archived',updated_at=? WHERE id=? AND project_id=?").run(now, conversationId, projectId)
    if (!result.changes) throw new Error('Conversation not found')
    const row = this.db.prepare('SELECT * FROM agent_conversations WHERE id=?').get(conversationId) as any
    return mapAgentConversation(row)
  }

  saveAgentMessage(message: AgentMessage): AgentMessage {
    this.ensureWritable()
    const stored = this.db.prepare('SELECT sequence_number FROM agent_messages WHERE id=?').get(message.id) as { sequence_number: number } | undefined
    const sequenceNumber = stored?.sequence_number ?? (this.db.prepare(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next FROM agent_messages WHERE conversation_id=?'
    ).get(message.conversationId) as { next: number }).next
    this.db.prepare(`INSERT INTO agent_messages(
      id,conversation_id,role,kind,content,status,diagnostic_snapshot_json,error_code,error_message,created_at,updated_at,completed_at,sequence_number
    ) VALUES(@id,@conversationId,@role,@kind,@content,@status,@diagnosticSnapshotJson,@errorCode,@errorMessage,@createdAt,@updatedAt,@completedAt,@sequenceNumber)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content,status=excluded.status,error_code=excluded.error_code,
      error_message=excluded.error_message,updated_at=excluded.updated_at,completed_at=excluded.completed_at`).run({
      ...message,
      diagnosticSnapshotJson: message.diagnosticSnapshot ? JSON.stringify(message.diagnosticSnapshot) : null,
      errorCode: message.errorCode ?? null,
      errorMessage: message.errorMessage ?? null,
      completedAt: message.completedAt ?? null,
      sequenceNumber
    })
    return message
  }

  listAgentMessages(projectId: string, conversationId: string): AgentMessage[] {
    return (this.db.prepare(`SELECT m.* FROM agent_messages m JOIN agent_conversations c ON c.id=m.conversation_id
      WHERE c.project_id=? AND c.id=? ORDER BY m.sequence_number`).all(projectId, conversationId) as any[]).map(mapAgentMessage)
  }

  setCurrentConversation(projectId: string, conversationId: string): void {
    this.ensureWritable()
    const owned = this.db.prepare('SELECT id FROM agent_conversations WHERE id=? AND project_id=?').get(conversationId, projectId)
    if (!owned) throw new Error('Conversation not found')
    this.db.prepare(`INSERT INTO project_conversation_state(project_id,conversation_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET conversation_id=excluded.conversation_id,updated_at=excluded.updated_at`)
      .run(projectId, conversationId, new Date().toISOString())
  }

  getCurrentConversationId(projectId: string): string | undefined {
    return (this.db.prepare('SELECT conversation_id FROM project_conversation_state WHERE project_id=?').get(projectId) as { conversation_id: string } | undefined)?.conversation_id
  }

  recoverInterruptedMessages(at: string): number {
    if (this.recoveryMode) return 0
    return Number(this.db.prepare(`UPDATE agent_messages SET status='interrupted',updated_at=?,completed_at=?
      WHERE status IN ('pending','streaming')`).run(at, at).changes)
  }

  private mapDiagnosticIncident(row: any): DiagnosticIncidentDetail {
    const groups = (this.db.prepare('SELECT * FROM diagnostic_groups WHERE incident_id=? ORDER BY created_at,id').all(row.id) as any[]).map(group => {
      const occurrences = (this.db.prepare('SELECT * FROM diagnostic_occurrences WHERE group_id=? ORDER BY file,line,column_number,id').all(group.id) as any[])
        .map(mapDiagnosticOccurrence)
      return {
        id: group.id, incidentId: group.incident_id, fingerprint: group.fingerprint, source: group.source,
        ...(group.code ? { code: group.code } : {}), failureKind: group.failure_kind, severity: group.severity,
        title: group.title, normalizedTemplate: group.normalized_template, occurrenceCount: group.occurrence_count,
        createdAt: group.created_at, occurrences
      }
    })
    return {
      id: row.id, projectId: row.project_id, attemptId: row.attempt_id, targetKey: row.target_key,
      operation: row.operation, failureKinds: JSON.parse(row.failure_kinds_json), status: row.status,
      ...(row.acknowledged_at ? { acknowledgedAt: row.acknowledged_at } : {}), createdAt: row.created_at,
      updatedAt: row.updated_at, ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}), groups
    }
  }

  private replaceAgentSteps(run: AgentRun): void {
    this.db.prepare('DELETE FROM agent_steps WHERE run_id = ?').run(run.id)
    const insert = this.db.prepare(`INSERT INTO agent_steps(
      run_id,id,sequence,kind,status,title,tool_name,summary,started_at,finished_at
    ) VALUES(@runId,@id,@sequence,@kind,@status,@title,@toolName,@summary,@startedAt,@finishedAt)`)
    for (const step of run.steps) insert.run({
      runId: run.id,
      ...step,
      toolName: step.toolName ?? null,
      summary: step.summary ?? null,
      startedAt: step.startedAt ?? null,
      finishedAt: step.finishedAt ?? null
    })
  }

  private ensureWritable(): void { if (this.recoveryMode) throw new Error('Database is in read-only recovery mode') }
}

const normalizeRoot = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
const mapWorkspace = (r: any): Workspace => ({ id: r.id, name: r.name, rootPath: r.root_path, trustState: r.trust_state, createdAt: r.created_at, lastOpenedAt: r.last_opened_at })
const mapProject = (r: any): Project => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, type: r.type, creationMode: r.creation_mode, relativeRoot: r.relative_root, ...(r.problem_id ? { problemId: r.problem_id } : {}), createdAt: r.created_at, updatedAt: r.updated_at, lastOpenedAt: r.last_opened_at })
const mapAgentConversation = (r: any): AgentConversation => ({
  id: r.id, projectId: r.project_id, title: r.title, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at
})
const mapAgentMessage = (r: any): AgentMessage => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, kind: r.kind, content: r.content, status: r.status,
  ...(r.diagnostic_snapshot_json ? { diagnosticSnapshot: JSON.parse(r.diagnostic_snapshot_json) } : {}),
  ...(r.error_code ? { errorCode: r.error_code } : {}), ...(r.error_message ? { errorMessage: r.error_message } : {}),
  createdAt: r.created_at, updatedAt: r.updated_at, ...(r.completed_at ? { completedAt: r.completed_at } : {})
})
const mapDiagnosticOccurrence = (r: any) => ({
  id: r.id, groupId: r.group_id, ...(r.file ? { file: r.file } : {}), ...(r.line ? { line: r.line } : {}),
  ...(r.column_number ? { column: r.column_number } : {}), ...(r.end_line ? { endLine: r.end_line } : {}),
  ...(r.end_column ? { endColumn: r.end_column } : {}), rawMessage: r.raw_message, normalizedMessage: r.normalized_message
})
const mapToolchainProfile = (r: any): ToolchainProfile => ({
  id: r.id,
  family: r.family,
  version: r.version,
  targetArch: r.target_arch,
  compilerPath: r.compiler_path,
  ...(r.debugger_path ? { debuggerPath: r.debugger_path } : {}),
  ...(r.environment_script ? { environmentScript: r.environment_script } : {}),
  ...(r.language_server_path ? { languageServerPath: r.language_server_path } : {}),
  ...(r.cmake_generator ? { cmakeGenerator: r.cmake_generator } : {}),
  ...(r.compile_commands_path ? { compileCommandsPath: r.compile_commands_path } : {}),
  capabilities: JSON.parse(r.capabilities_json),
  verifiedAt: r.verified_at
})

const agentRunParams = (run: AgentRun) => ({
  ...run,
  projectId: run.projectId ?? null,
  activeFile: run.activeFile ?? null,
  conversationId: run.conversationId ?? null,
  assistantMessageId: run.assistantMessageId ?? null,
  intent: run.intent ?? null,
  planSummary: run.planSummary ?? null,
  response: run.response ?? null,
  validationSummary: run.validationSummary ?? null,
  errorCode: run.errorCode ?? null,
  errorMessage: run.errorMessage ?? null,
  stepsJson: JSON.stringify(run.steps),
  pendingApprovalJson: run.pendingApproval ? JSON.stringify(run.pendingApproval) : null,
  pendingClarificationJson: run.pendingClarification ? JSON.stringify(run.pendingClarification) : null,
  completedAt: run.completedAt ?? null
})

const mapAgentRun = (r: any): AgentRun => ({
  id: r.id,
  requestId: r.request_id,
  source: r.source,
  mode: r.mode,
  message: r.message,
  ...(r.project_id ? { projectId: r.project_id } : {}),
  ...(r.active_file ? { activeFile: r.active_file } : {}),
  ...(r.conversation_id ? { conversationId: r.conversation_id } : {}),
  ...(r.assistant_message_id ? { assistantMessageId: r.assistant_message_id } : {}),
  status: r.status,
  ...(r.intent ? { intent: r.intent } : {}),
  ...(r.plan_summary ? { planSummary: r.plan_summary } : {}),
  ...(r.response ? { response: r.response } : {}),
  ...(r.validation_summary ? { validationSummary: r.validation_summary } : {}),
  ...(r.error_code ? { errorCode: r.error_code } : {}),
  ...(r.error_message ? { errorMessage: r.error_message } : {}),
  steps: JSON.parse(r.steps_json),
  ...(r.pending_approval_json ? { pendingApproval: JSON.parse(r.pending_approval_json) } : {}),
  ...(r.pending_clarification_json ? { pendingClarification: JSON.parse(r.pending_clarification_json) } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.completed_at ? { completedAt: r.completed_at } : {})
})

const mapTimelineEvent = (r: any): TimelineEvent => ({
  id: r.id,
  runId: r.run_id,
  sequence: r.sequence,
  kind: r.kind,
  status: r.status,
  title: r.title,
  summary: r.summary,
  occurredAt: r.occurred_at,
  ...(r.step_id ? { stepId: r.step_id } : {}),
  ...(r.data_json ? { data: JSON.parse(r.data_json) } : {})
})

const mapApproval = (r: any): Approval => ({
  id: r.id,
  runId: r.run_id,
  stepId: r.step_id,
  toolName: r.tool_name,
  risk: r.risk,
  title: r.title,
  description: r.description,
  parameterSummary: JSON.parse(r.parameter_summary_json),
  ...(r.diff_text ? { diff: r.diff_text } : {}),
  sideEffects: JSON.parse(r.side_effects_json),
  status: r.status,
  ...(r.decision_reason ? { decisionReason: r.decision_reason } : {}),
  createdAt: r.created_at,
  ...(r.decided_at ? { decidedAt: r.decided_at } : {})
})

const mapToolCall = (r: any): ToolCall => ({
  id: r.id,
  runId: r.run_id,
  stepId: r.step_id,
  serverName: r.server_name,
  toolName: r.tool_name,
  risk: r.risk,
  parameterSummary: JSON.parse(r.parameter_summary_json),
  ...(r.result_json ? { result: JSON.parse(r.result_json) } : {}),
  status: r.status,
  startedAt: r.started_at,
  ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
  ...(r.duration_ms !== null ? { durationMs: r.duration_ms } : {}),
  ...(r.error_code ? { errorCode: r.error_code } : {})
})

const mapAgentModelSession = (r: any): AgentModelSessionRecord => ({
  runId: r.run_id,
  protocol: r.protocol,
  state: parseJsonOrNull(r.state_json),
  updatedAt: r.updated_at
})

function parseJsonOrNull(value: string): unknown {
  try { return JSON.parse(value) }
  catch { return null }
}

const mapKnowledgeNode = (r: any): KnowledgeNode => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.category,
  difficulty: r.difficulty,
  prerequisites: JSON.parse(r.prerequisites_json),
  tags: JSON.parse(r.tags_json)
})

const mapLearnerKnowledge = (r: any): LearnerKnowledge => ({
  userId: r.user_id,
  conceptId: r.concept_id,
  status: r.status,
  confidence: r.confidence,
  ...(r.verified_at ? { verifiedAt: r.verified_at } : {}),
  ...(r.last_evidence_id ? { lastEvidenceId: r.last_evidence_id } : {}),
  updatedAt: r.updated_at
})

const mapBackgroundProfile = (r: any): BackgroundProfile => ({
  userId: r.user_id,
  onboardingCompleted: Boolean(r.onboarding_completed),
  startingPoint: r.starting_point,
  studiedConceptIds: JSON.parse(r.studied_concept_ids_json),
  focusConceptIds: JSON.parse(r.focus_concept_ids_json),
  updatedAt: r.updated_at
})

const mapErrorBookEntry = (r: any): ErrorBookEntry => ({
  id: r.id,
  userId: r.user_id,
  ...(r.project_id ? { projectId: r.project_id } : {}),
  ...(r.relative_path ? { relativePath: r.relative_path } : {}),
  category: r.category,
  title: r.title,
  evidence: r.evidence,
  conceptIds: JSON.parse(r.concept_ids_json),
  status: r.status,
  occurrences: r.occurrences,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
  ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
  ...(r.next_review_at ? { nextReviewAt: r.next_review_at } : {})
})

const mapReviewItem = (r: any): ReviewItem => ({
  id: r.id,
  userId: r.user_id,
  ...(r.error_book_entry_id ? { errorBookEntryId: r.error_book_entry_id } : {}),
  conceptId: r.concept_id,
  prompt: r.prompt,
  expectedEvidence: r.expected_evidence,
  intervalIndex: r.interval_index,
  dueAt: r.due_at,
  status: r.status,
  ...(r.completed_at ? { completedAt: r.completed_at } : {})
})

const mapLearningEvent = (r: any): LearningEvent => ({
  id: r.id,
  sourceEventId: r.source_event_id,
  userId: r.user_id,
  type: r.type,
  conceptIds: JSON.parse(r.concept_ids_json),
  xp: r.xp,
  evidence: JSON.parse(r.evidence_json),
  occurredAt: r.occurred_at
})

const mapLearnerAchievement = (r: any): LearnerAchievement => ({
  userId: r.user_id,
  achievementId: r.achievement_id,
  sourceEventId: r.source_event_id,
  unlockedAt: r.unlocked_at
})

const mapModelProfile = (r: any): ModelProfile => ({
  id: r.id,
  name: r.name,
  baseUrl: r.base_url,
  model: r.model,
  enabled: Boolean(r.enabled),
  timeoutMs: r.timeout_ms,
  apiKeyConfigured: Boolean(r.api_key_configured),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

function resolveCursorStyle(saved: Partial<AppSettings> & { customCursor?: boolean }): CursorStyle {
  if (saved.cursorStyle === 'system' || saved.cursorStyle === 'classic' || saved.cursorStyle === 'mascot') return saved.cursorStyle
  // 兼容旧版 boolean 开关：关闭 -> 系统光标，开启/缺失 -> 新版桌宠光标
  if (saved.customCursor === false) return 'system'
  return 'mascot'
}
