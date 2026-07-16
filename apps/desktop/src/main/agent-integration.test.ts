import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '@cpp-pet/database'
import { WorkspaceService } from '@cpp-pet/workspace-core'
import { ToolchainService } from '@cpp-pet/cpp-local-tools'
import { AgentRuntime, H3WorkflowPlanner, KnowledgeGate, achievementDefinitions, builtInKnowledge } from '@cpp-pet/agent-runtime'
import { DatabaseRuntimeStore, DesktopContextBuilder, DesktopMcpAdapter, DesktopPlanner, McpRuntimeToolClient } from './agent-integration'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('desktop H3 integration', () => {
  it('runs through MCP and persists the real file evidence timeline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-integration-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const draft = workspaceService.previewProject({ mode: 'manual', workspaceId: workspace.id, name: 'Agent 解释', type: 'single-file' })
    const project = workspaceService.commitDraft(draft.draftId)
    const document = workspaceService.readFile(project.id, 'main.cpp')
    await workspaceService.writeFile(project.id, 'main.cpp', 'int main() { return 0; }\n', document.contentHash, false)

    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const toolClient = await McpRuntimeToolClient.connect(adapter)
    cleanups.push(() => toolClient.close())
    const store = new DatabaseRuntimeStore(db)
    const runtime = new AgentRuntime({
      store,
      contextBuilder: new DesktopContextBuilder(workspaceService, db),
      planner: new H3WorkflowPlanner(),
      toolClient,
      knowledgeGate: new KnowledgeGate(builtInKnowledge)
    })

    const run = await runtime.start({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释选区',
      projectId: project.id, activeFile: 'main.cpp',
      selection: { startLine: 1, startColumn: 14, endLine: 1, endColumn: 22, content: 'return 0;' },
      diagnostics: [{ source: 'compiler', severity: 'warning', rawMessage: 'unused', normalizedMessage: '未使用的返回值', relatedConceptIds: [] }]
    })

    expect(run.status).toBe('completed')
    const detail = db.getAgentRun(run.id)
    expect(detail?.timeline.some(event => event.kind === 'tool' && event.data?.toolName === 'workspace.read_file')).toBe(false)
    expect(run.response).toContain('return')
    const contextData = detail?.timeline.find(event => event.kind === 'context')?.data as { sources?: Array<{ kind?: string }> } | undefined
    expect(contextData?.sources?.some(source => source.kind === 'selection')).toBe(true)
    expect(contextData?.sources?.some(source => source.kind === 'diagnostic')).toBe(true)
  })

  it('builds selection context without exposing the complete file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-selection-context-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: '最小上下文', type: 'single-file'
    }).draftId)
    const builder = new DesktopContextBuilder(workspaceService, db)

    const context = await builder.build({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释选区', projectId: project.id, activeFile: 'main.cpp',
      selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, content: 'return 0;' }
    })

    expect(context.sources.map(item => item.kind)).toEqual(['selection', 'learning'])
    expect(context.sources.some(item => item.kind === 'file')).toBe(false)
  })

  it('requests L3 approval without exposing secrets before remote planning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-remote-approval-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const now = new Date().toISOString()
    const profile = db.saveModelProfile({
      id: crypto.randomUUID(), name: '课程模型', baseUrl: 'https://example.test/v1', model: 'teacher', enabled: true,
      timeoutMs: 10_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    })
    const planner = new DesktopPlanner(db, { get: id => id === profile.id ? 'top-secret-key' : undefined })

    const approval = planner.contextApproval?.(
      { requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释代码' },
      { requestId: crypto.randomUUID(), sources: [{ kind: 'selection', label: 'main.cpp:1-2', content: 'top-secret-code', trusted: true }], conceptIds: [], tokenEstimate: 4, truncated: false }
    )
    const serialized = JSON.stringify(approval)

    expect(approval).toMatchObject({ risk: 'L3', sideEffects: ['remote-request'] })
    expect(serialized).not.toContain('top-secret-code')
    expect(serialized).not.toContain('top-secret-key')
  })

  it('connects to the local MCP server through a spawned stdio process', async () => {
    const worker = new URL('./fixtures/stdio-mcp-server.mjs', import.meta.url)
    const toolClient = await McpRuntimeToolClient.connectStdio({ command: process.execPath, args: [worker.pathname.slice(1)] })
    cleanups.push(() => toolClient.close())

    const result = await toolClient.call('workspace.list_files', { projectId: crypto.randomUUID() }, new AbortController().signal)

    expect(result).toMatchObject({ ok: true, summary: 'stdio-ready', structuredContent: { transport: 'stdio' } })
  })

  it('closes a silent stdio worker when the MCP handshake times out', async () => {
    const worker = new URL('./fixtures/silent-mcp-server.mjs', import.meta.url)
    const startedAt = Date.now()

    await expect(McpRuntimeToolClient.connectStdio(
      { command: process.execPath, args: [worker.pathname.slice(1)] },
      200
    )).rejects.toThrow()
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  }, 5_000)

  it('maps every registered H2 engineering tool through the desktop MCP adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-tools-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const draft = workspaceService.previewProject({ mode: 'manual', workspaceId: workspace.id, name: 'MCP 工程', type: 'cmake' })
    const project = workspaceService.commitDraft(draft.draftId)
    const projectRoot = workspaceService.projectRoot(project.id).root
    writeFileSync(join(projectRoot, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)\nproject(McpTools)\n')
    writeFileSync(join(projectRoot, 'main.cpp'), 'int main() { return 0; }\n')
    const debuggerPath = join(dir, 'gdb.exe')
    writeFileSync(debuggerPath, '')
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: 'test', targetArch: 'x64',
      compilerPath: join(dir, 'g++.exe'), debuggerPath, capabilities: { compile: true, debug: true, compileDatabase: true },
      verifiedAt: new Date().toISOString()
    }
    db.saveToolchainProfile(profile)
    db.setActiveToolchain(profile.id)

    const calls: string[] = []
    const processResult = { command: 'fake', args: [], exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, cancelled: false, outputTruncated: false }
    const toolchainService = {
      resolveToolPath(kind: string) { return join(dir, `${kind}.exe`) },
      async buildCmakeProject(options: { buildDirectory: string; projectRoot: string }) {
        calls.push('cmake.build')
        mkdirSync(options.buildDirectory, { recursive: true })
        return { success: true, configure: processResult, build: processResult, diagnostics: [], compileCommandsGenerated: true, sourceDirectory: options.projectRoot }
      },
      async runCtest() {
        calls.push('ctest.run')
        return { success: true, process: processResult, diagnostics: [], total: 1, passed: 1, failed: 0 }
      },
      async analyzeWithClangTidy() {
        calls.push('analysis.clang_tidy')
        return { success: true, process: processResult, diagnostics: [] }
      },
      async openInVsCode() {
        calls.push('vscode.open_file')
        return processResult
      },
      async buildSingleFile(options: { outputDirectory: string }) {
        calls.push('debug.build')
        mkdirSync(options.outputDirectory, { recursive: true })
        const artifactPath = join(options.outputDirectory, 'debug.exe')
        writeFileSync(artifactPath, '')
        return { success: true, artifactPath, process: processResult, diagnostics: [] }
      }
    } as unknown as ToolchainService
    const debugStates = {
      started: { sessionId: '', projectId: project.id, status: 'stopped' as const, frames: [], variables: [], output: '', diagnostics: [] },
      stopped: { sessionId: '', projectId: project.id, status: 'exited' as const, frames: [], variables: [], output: '', diagnostics: [] }
    }
    const options = {
      db, workspaceService, toolchainService, buildRoot: join(dir, 'builds'),
      debugSessionFactory: (sessionId: string) => ({
        async initialize() { calls.push('debug.start'); return { ...debugStates.started, sessionId } },
        async execute() { calls.push('debug.command'); return { ...debugStates.stopped, sessionId } },
        async dispose() {}
      })
    }
    const adapter = new DesktopMcpAdapter(options)
    const signal = new AbortController().signal
    const runId = crypto.randomUUID()

    const cmake = await adapter.execute('cmake.build', { runId, projectId: project.id, configuration: 'Debug', standard: 'c++17' }, { signal, onProgress: async () => undefined })
    const buildId = (cmake.structuredContent as { buildId?: string } | undefined)?.buildId ?? 'missing-build'
    const results = [
      cmake,
      await adapter.execute('ctest.run', { runId: crypto.randomUUID(), buildId, timeoutMs: 30_000 }, { signal, onProgress: async () => undefined }),
      await adapter.execute('analysis.clang_tidy', { runId: crypto.randomUUID(), projectId: project.id, relativePath: 'main.cpp', standard: 'c++17' }, { signal, onProgress: async () => undefined }),
      await adapter.execute('vscode.open_file', { projectId: project.id, relativePath: 'main.cpp', line: 1, column: 1 }, { signal, onProgress: async () => undefined })
    ]
    const debug = await adapter.execute('debug.start', { projectId: project.id, relativePath: 'main.cpp', standard: 'c++17', breakpoints: [{ relativePath: 'main.cpp', line: 1 }] }, { signal, onProgress: async () => undefined })
    results.push(debug)
    const sessionId = (debug.structuredContent as { sessionId?: string } | undefined)?.sessionId ?? crypto.randomUUID()
    results.push(await adapter.execute('debug.command', { sessionId, command: 'stop' }, { signal, onProgress: async () => undefined }))

    expect(results.every(result => result.ok)).toBe(true)
    expect(calls).toEqual(['cmake.build', 'ctest.run', 'analysis.clang_tidy', 'vscode.open_file', 'debug.build', 'debug.start', 'debug.command'])
  })

  it('maps a real compiler failure to a failed ToolResult', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-build-failure-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: '失败构建', type: 'single-file'
    }).draftId)
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: 'test', targetArch: 'x64', compilerPath: join(dir, 'g++.exe'),
      capabilities: { compile: true, debug: false, compileDatabase: false }, verifiedAt: new Date().toISOString()
    }
    db.saveToolchainProfile(profile)
    db.setActiveToolchain(profile.id)
    const process = { command: 'fake', args: [], exitCode: 1, stdout: '', stderr: 'expected ;', durationMs: 1, timedOut: false, cancelled: false, outputTruncated: false }
    const toolchainService = {
      async buildSingleFile() {
        return {
          success: false, artifactPath: join(dir, 'missing.exe'), process,
          diagnostics: [{ source: 'compiler', severity: 'error', rawMessage: 'expected ;', normalizedMessage: '缺少分号', relatedConceptIds: [] }]
        }
      }
    } as unknown as ToolchainService
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService, buildRoot: join(dir, 'builds') })

    const result = await adapter.execute('compiler.build', {
      runId: crypto.randomUUID(), projectId: project.id, relativePath: 'main.cpp', standard: 'c++17'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(result).toMatchObject({ ok: false, exitCode: 1, errorCode: 'BUILD_FAILED' })
    expect(result.diagnostics).toHaveLength(1)
  })

  it('records environment readiness only after a toolchain is really bound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-environment-growth-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: 'test', targetArch: 'x64', compilerPath: join(dir, 'g++.exe'),
      capabilities: { compile: true, debug: false, compileDatabase: false }, verifiedAt: new Date().toISOString()
    }
    const toolchainService = { async bind() { return profile } } as unknown as ToolchainService
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService, buildRoot: join(dir, 'builds') })

    const result = await adapter.execute('toolchain.bind_compiler', { candidateId: 'gcc:test' }, {
      signal: new AbortController().signal, onProgress: async () => undefined
    })

    expect(result.ok).toBe(true)
    expect(db.listLearningEvents('local-user').map(item => item.type)).toContain('environment-ready')
    expect(db.getLearnerSummary('local-user').achievements.map(item => item.achievementId)).toContain('environment-ready')
  })

  it('rolls back error, review and XP writes when achievement persistence fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-learning-rollback-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })

    const result = await adapter.execute('learning.record_error', {
      userId: 'local-user', category: 'compile', title: '事务回滚', evidenceId: crypto.randomUUID(),
      evidence: '重新编译通过', conceptIds: ['control.loops'], status: 'resolved'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(result.ok).toBe(false)
    expect(db.listErrorBookEntries('local-user')).toEqual([])
    expect(db.listReviewItems('local-user')).toEqual([])
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').xp).toBe(0)
  })

  it('records verified build and project completion events after an Agent-created project builds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-project-growth-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: 'test', targetArch: 'x64', compilerPath: join(dir, 'g++.exe'),
      capabilities: { compile: true, debug: false, compileDatabase: false }, verifiedAt: new Date().toISOString()
    }
    db.saveToolchainProfile(profile)
    db.setActiveToolchain(profile.id)
    const process = { command: 'fake', args: [], exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, cancelled: false, outputTruncated: false }
    const toolchainService = {
      async buildSingleFile() {
        return { success: true, artifactPath: join(dir, 'program.exe'), process, diagnostics: [] }
      }
    } as unknown as ToolchainService
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService, buildRoot: join(dir, 'builds') })
    const context = { signal: new AbortController().signal, onProgress: async () => undefined }

    const created = await adapter.execute('project.create', { mode: 'description', name: '成长项目', description: '输出 Hello' }, context)
    const projectId = (created.structuredContent as { projectId: string }).projectId
    const build = await adapter.execute('compiler.build', {
      runId: crypto.randomUUID(), projectId, relativePath: 'main.cpp', standard: 'c++17'
    }, context)

    expect(build.ok).toBe(true)
    expect(db.listLearningEvents('local-user').map(item => item.type)).toEqual(expect.arrayContaining(['build-succeeded', 'project-completed']))
    expect(db.getLearnerSummary('local-user').achievements.map(item => item.achievementId)).toEqual(expect.arrayContaining(['first-build', 'project-first']))
  })

  it('records a test event only after real cases pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-test-growth-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: '测试成长', type: 'single-file'
    }).draftId)
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: 'test', targetArch: 'x64', compilerPath: join(dir, 'g++.exe'),
      capabilities: { compile: true, debug: false, compileDatabase: false }, verifiedAt: new Date().toISOString()
    }
    db.saveToolchainProfile(profile)
    db.setActiveToolchain(profile.id)
    const processResult = { command: 'fake', args: [], exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, cancelled: false, outputTruncated: false }
    const toolchainService = {
      async buildSingleFile() { return { success: true, artifactPath: process.execPath, process: processResult, diagnostics: [] } }
    } as unknown as ToolchainService
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService, buildRoot: join(dir, 'builds') })

    const result = await adapter.execute('tests.run_cases', {
      runId: crypto.randomUUID(), projectId: project.id, relativePath: 'main.cpp', standard: 'c++17',
      cases: [{ input: 'console.log("OK")', expectedOutput: 'OK' }]
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(result.ok).toBe(true)
    expect(db.listLearningEvents('local-user').map(item => item.type)).toContain('test-passed')
    expect(db.getLearnerSummary('local-user').achievements.map(item => item.achievementId)).toContain('first-test')
  })

  it('records one idempotent error, review, XP reward and achievement from verified evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-learning-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const evidenceId = 'run:verified-fix:build-2'
    const input = {
      userId: 'local-user', category: 'compile', title: '缺少分号', evidenceId,
      evidence: '首次构建失败，应用补丁后重新构建通过。', conceptIds: ['basics.statements'], status: 'resolved'
    }
    const context = { signal: new AbortController().signal, onProgress: async () => undefined }

    const first = await adapter.execute('learning.record_error', input, context)
    const replay = await adapter.execute('learning.record_error', input, context)
    const summary = db.getLearnerSummary('local-user')

    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    expect(db.listErrorBookEntries('local-user')).toHaveLength(1)
    expect(db.listReviewItems('local-user')).toHaveLength(1)
    expect(summary.xp).toBe(20)
    expect(summary.achievements.map(item => item.achievementId)).toContain('first-fix')
  })

  it('advances a passed review through the spaced repetition schedule', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-review-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedKnowledge(builtInKnowledge)
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const reviewItemId = crypto.randomUUID()
    const dueAt = new Date(Date.now() - 1_000).toISOString()
    db.saveReviewItem({
      id: reviewItemId, userId: 'local-user', conceptId: 'control.loops', prompt: '解释循环边界',
      expectedEvidence: '用户完成复习并确认', intervalIndex: 0, dueAt, status: 'pending'
    })

    const result = await adapter.execute('learning.update_state', {
      userId: 'local-user', conceptId: 'control.loops', status: 'verified', evidenceId: 'review-pass-1',
      reviewItemId, reviewOutcome: 'passed'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })
    const review = db.listReviewItems('local-user')[0]

    expect(result.ok).toBe(true)
    expect(review).toMatchObject({ id: reviewItemId, intervalIndex: 1, status: 'pending' })
    expect(new Date(review!.dueAt).getTime()).toBeGreaterThan(new Date(dueAt).getTime())
    expect(db.listLearningEvents('local-user').map(item => item.type)).toEqual(expect.arrayContaining(['review-completed', 'concept-verified']))
    expect(db.getLearnerSummary('local-user').achievements.map(item => item.achievementId)).toEqual(expect.arrayContaining(['review-first', 'first-concept']))
  })

  it('resets a failed review without awarding XP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-review-failed-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedKnowledge(builtInKnowledge)
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const reviewItemId = crypto.randomUUID()
    db.saveReviewItem({
      id: reviewItemId, userId: 'local-user', conceptId: 'control.loops', prompt: '解释循环边界',
      expectedEvidence: '用户完成复习并确认', intervalIndex: 3, dueAt: new Date(Date.now() - 1_000).toISOString(), status: 'pending'
    })

    const result = await adapter.execute('learning.update_state', {
      userId: 'local-user', conceptId: 'control.loops', status: 'review', evidenceId: 'review-failed-1',
      reviewItemId, reviewOutcome: 'failed'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(result.ok).toBe(true)
    expect(db.listReviewItems('local-user')[0]).toMatchObject({ intervalIndex: 0, status: 'pending' })
    expect(db.listLearningEvents('local-user')[0]).toMatchObject({ type: 'review-failed', xp: 0 })
    expect(db.getLearnerSummary('local-user').xp).toBe(0)
  })

  it('completes a review after the final spaced repetition interval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-review-final-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedKnowledge(builtInKnowledge)
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const reviewItemId = crypto.randomUUID()
    db.saveReviewItem({
      id: reviewItemId, userId: 'local-user', conceptId: 'control.loops', prompt: '解释循环边界',
      expectedEvidence: '用户完成复习并确认', intervalIndex: 4, dueAt: new Date(Date.now() - 1_000).toISOString(), status: 'pending'
    })

    await adapter.execute('learning.update_state', {
      userId: 'local-user', conceptId: 'control.loops', status: 'verified', evidenceId: 'review-pass-final',
      reviewItemId, reviewOutcome: 'passed'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(db.listReviewItems('local-user')[0]).toMatchObject({ intervalIndex: 4, status: 'completed' })
    expect(db.listReviewItems('local-user')[0]?.completedAt).toBeDefined()
  })

  it('serves the registered project problem and latest diagnostics resources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-resources-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const draft = workspaceService.previewProject({
      mode: 'problem', workspaceId: workspace.id, name: '题目资源', type: 'single-file',
      statement: '输出 Hello', constraints: ['无输入'], samples: [{ input: '', output: 'Hello' }]
    })
    const project = workspaceService.commitDraft(draft.draftId)
    const run = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor' as const, mode: 'diagnose' as const,
      message: '诊断', projectId: project.id, activeFile: 'main.cpp', status: 'completed' as const, steps: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString()
    }
    db.createAgentRun(run)
    db.saveToolCall({
      id: crypto.randomUUID(), runId: run.id, stepId: 'build', serverName: 'cpppilot-local-tools', toolName: 'compiler.build', risk: 'L1',
      parameterSummary: {}, status: 'failed', startedAt: run.createdAt, finishedAt: run.updatedAt, durationMs: 2,
      result: {
        ok: false, exitCode: 1, summary: '编译失败', artifacts: [], sideEffects: [], retryable: false, durationMs: 2,
        diagnostics: [{ source: 'compiler', severity: 'error', rawMessage: 'expected ;', normalizedMessage: '缺少分号', relatedConceptIds: [] }]
      }
    })
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })

    const problem = JSON.parse((await adapter.readResource(`cpplearn://project/${project.id}/problem`)).text)
    const diagnostics = JSON.parse((await adapter.readResource(`cpplearn://project/${project.id}/diagnostics/latest`)).text)

    expect(problem).toMatchObject({ statement: '输出 Hello', constraints: ['无输入'] })
    expect(diagnostics).toMatchObject({ runId: run.id, diagnostics: [{ normalizedMessage: '缺少分号' }] })
  })

  it.runIf(process.platform === 'win32')('executes all seven H3 workflows through the real H2 adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-agent-seven-workflows-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    db.seedKnowledge(builtInKnowledge)
    db.seedAchievementDefinitions(achievementDefinitions)
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: '七工作流', type: 'single-file'
    }).draftId)
    const now = new Date().toISOString()
    for (const conceptId of ['basics.program', 'basics.variables', 'basics.types', 'basics.operators', 'basics.expressions', 'control.conditions', 'control.loops', 'functions.basic']) {
      db.upsertLearnerKnowledge({ userId: 'local-user', conceptId, status: 'verified', confidence: 1, verifiedAt: now, lastEvidenceId: 'fixture:knowledge', updatedAt: now })
    }
    const adapter = new DesktopMcpAdapter({ db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds') })
    const toolClient = await McpRuntimeToolClient.connect(adapter)
    cleanups.push(() => toolClient.close())
    const runtime = new AgentRuntime({
      store: new DatabaseRuntimeStore(db), contextBuilder: new DesktopContextBuilder(workspaceService, db),
      planner: new H3WorkflowPlanner(), toolClient, knowledgeGate: new KnowledgeGate(builtInKnowledge)
    })
    const complete = async (input: Parameters<AgentRuntime['start']>[0]) => {
      let run = await runtime.start(input)
      while (run.status === 'waiting-approval') {
        run = await runtime.decide({ approvalId: run.pendingApproval!.id, decision: 'approved' })
      }
      expect(run.status).toBe('completed')
      return db.getAgentRun(run.id)!
    }

    const environment = await complete({ requestId: crypto.randomUUID(), source: 'main', mode: 'environment', message: '检测并绑定本机 C++ 环境' })
    const createdProject = await complete({ requestId: crypto.randomUUID(), source: 'main', mode: 'project', message: '创建一个输出 Hello 的控制台程序' })
    const explain = await complete({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释 return', projectId: project.id, activeFile: 'main.cpp',
      selection: { startLine: 1, startColumn: 14, endLine: 1, endColumn: 22, content: 'return 0;' }
    })

    let document = workspaceService.readFile(project.id, 'main.cpp')
    await workspaceService.writeFile(project.id, 'main.cpp', '#include <iostream>\nint main() {\n  std::cout << "missing semicolon"\n  return 0;\n}\n', document.contentHash, false)
    const diagnose = await complete({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '修复当前编译错误并解释根因', projectId: project.id, activeFile: 'main.cpp'
    })

    document = workspaceService.readFile(project.id, 'main.cpp')
    const logicSource = [
      '#include <iostream>',
      'int main() {',
      '  int n = 0;',
      '  if (!(std::cin >> n)) return 0;',
      '  if (n == 3) { for (int i = 0; i <= n; ++i) { if (i) std::cout << " "; std::cout << i; } }',
      '  else { std::cout << "none"; }',
      '  return 0;',
      '}',
      ''
    ].join('\n')
    await workspaceService.writeFile(project.id, 'main.cpp', logicSource, document.contentHash, false)
    const logic = await complete({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'solve',
      message: '检查循环边界。输入：3\n输出：0 1 2\n输入：1\n输出：none\n输入：2\n输出：none\n输入：4\n输出：none\n输入：5\n输出：none',
      projectId: project.id, activeFile: 'main.cpp'
    })

    const screenshot = await complete({
      requestId: crypto.randomUUID(), source: 'screenshot', mode: 'explain', message: '解释截图中的代码',
      screenshot: { id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 10, height: 10, createdAt: new Date().toISOString() }
    })
    const reviewItem = db.listReviewItems('local-user')[0]!
    db.saveReviewItem({ ...reviewItem, dueAt: new Date(Date.now() - 1_000).toISOString() })
    const review = await complete({
      requestId: crypto.randomUUID(), source: 'main', mode: 'review', message: reviewItem.prompt, reviewItemId: reviewItem.id, reviewOutcome: 'passed'
    })

    const details = [environment, createdProject, explain, diagnose, logic, screenshot, review]
    expect(details).toHaveLength(7)
    for (const detail of details) {
      expect(detail.timeline.map(item => item.kind)).toEqual(expect.arrayContaining([
        'intent', 'context', 'plan', 'policy', 'validation', 'learning', 'response'
      ]))
    }
    expect(environment.toolCalls.map(item => item.toolName)).toEqual(expect.arrayContaining(['toolchain.detect_compilers', 'toolchain.probe_compiler', 'toolchain.bind_compiler']))
    expect(createdProject.toolCalls.map(item => item.toolName)).toEqual(expect.arrayContaining(['project.create', 'compiler.build']))
    expect(explain.response).toContain('return')
    expect(diagnose.timeline.some(item => item.kind === 'validation')).toBe(true)
    expect(logic.timeline.some(item => item.kind === 'validation')).toBe(true)
    expect(screenshot.approvals.some(item => item.risk === 'L3' && item.status === 'approved')).toBe(true)
    expect(review.timeline.some(item => item.kind === 'learning')).toBe(true)
  }, 120_000)
})
