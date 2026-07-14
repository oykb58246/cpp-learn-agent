import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AppSettings, DomainEvent, Project, SnapshotManifest, Workspace } from '@cpp-pet/contracts'

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
const foundationMigration: Migration = { version: 1, name: 'h1-foundation', sql: foundationSql }
const migrationHash = (migration: Migration) => createHash('sha256').update(`${migration.version}:${migration.name}:${migration.sql}`).digest('hex')

export interface SnapshotRecord extends SnapshotManifest { manifestPath: string; blobHashes: Record<string, string> }

export class AppDatabase {
  readonly db: Database.Database
  readonly recoveryMode: boolean

  constructor(readonly filePath: string, additionalMigrations: Migration[] = []) {
    const migrations = [foundationMigration, ...additionalMigrations]
    mkdirSync(dirname(filePath), { recursive: true })
    this.db = new Database(filePath)
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
  }

  close(): void { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close() }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app') as { value_json: string } | undefined
    return row ? JSON.parse(row.value_json) as AppSettings : { theme: 'system', sidebarWidth: 260 }
  }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.ensureWritable()
    const next = { ...this.getSettings(), ...patch }
    this.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify(next))
    return next
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
  saveProject(project: Project): Project {
    this.ensureWritable()
    this.db.prepare(`INSERT INTO projects(id,workspace_id,name,type,creation_mode,relative_root,problem_id,created_at,updated_at,last_opened_at)
      VALUES(@id,@workspaceId,@name,@type,@creationMode,@relativeRoot,@problemId,@createdAt,@updatedAt,@lastOpenedAt)`).run({ ...project, problemId: project.problemId ?? null })
    return project
  }
  touchProject(id: string): Project { if (!this.recoveryMode) { const now = new Date().toISOString(); this.db.prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?').run(now, now, id) }; const p = this.getProject(id); if (!p) throw new Error('Project not found'); return p }
  removeProject(id: string): void { this.ensureWritable(); this.db.prepare('UPDATE projects SET removed_at = ? WHERE id = ?').run(new Date().toISOString(), id) }

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
  private ensureWritable(): void { if (this.recoveryMode) throw new Error('Database is in read-only recovery mode') }
}

const normalizeRoot = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
const mapWorkspace = (r: any): Workspace => ({ id: r.id, name: r.name, rootPath: r.root_path, trustState: r.trust_state, createdAt: r.created_at, lastOpenedAt: r.last_opened_at })
const mapProject = (r: any): Project => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, type: r.type, creationMode: r.creation_mode, relativeRoot: r.relative_root, ...(r.problem_id ? { problemId: r.problem_id } : {}), createdAt: r.created_at, updatedAt: r.updated_at, lastOpenedAt: r.last_opened_at })
