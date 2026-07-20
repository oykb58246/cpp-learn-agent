import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { AppDatabase } from '@cpp-pet/database'
import { WorkspaceService } from '@cpp-pet/workspace-core'
import { ToolchainService } from '@cpp-pet/cpp-local-tools'
import { achievementDefinitions, builtInKnowledge } from '@cpp-pet/agent-runtime'
import {
  DatabaseRuntimeStore,
  DesktopMcpAdapter,
  DesktopOpenAiContextBuilder,
  DesktopOpenAiModelFactory,
  McpRuntimeToolClient
} from './agent-integration'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('desktop H3 integration', () => {
  it('creates an Agent project only in the explicitly authorized workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-project-scope-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const firstRoot = join(dir, 'first')
    const targetRoot = join(dir, 'target')
    mkdirSync(firstRoot)
    mkdirSync(targetRoot)
    const first = workspaceService.registerWorkspace(firstRoot)
    const target = workspaceService.registerWorkspace(targetRoot)
    workspaceService.setTrust(first.id, true)
    workspaceService.setTrust(target.id, true)
    const adapter = new DesktopMcpAdapter({
      db, workspaceService, toolchainService: new ToolchainService(), buildRoot: join(dir, 'builds')
    })

    const result = await adapter.execute('project.create', {
      workspaceId: target.id, mode: 'description', name: 'Scoped project', description: 'hello'
    }, { signal: new AbortController().signal, onProgress: async () => undefined })

    expect(result.ok).toBe(true)
    expect((result.structuredContent as { project: { workspaceId: string } }).project.workspaceId).toBe(target.id)
  })

  it('persists runtime model sessions through the database store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-runtime-session-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const now = new Date().toISOString()
    const run = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor' as const, mode: 'auto' as const,
      message: '继续任务', status: 'waiting-input' as const, steps: [], createdAt: now, updatedAt: now
    }
    db.createAgentRun(run)
    const store = new DatabaseRuntimeStore(db)
    const session = {
      runId: run.id,
      protocol: 'cpppilot.openai-session.v1',
      state: { input: [{ role: 'user', content: [{ type: 'input_text', text: 'context' }] }] },
      updatedAt: now
    }

    await store.saveSession(session)

    expect(store.getSession(run.id)).toEqual(session)
    expect(store.listSessions()).toEqual([session])
    await store.deleteSession(run.id)
    expect(store.getSession(run.id)).toBeUndefined()
  })

  it('builds a strict OpenAI context envelope with the unchanged prompt and no absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-openai-context-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: '原始请求', type: 'single-file'
    }).draftId)
    const initialDocument = workspaceService.readFile(project.id, 'main.cpp')
    await workspaceService.writeFile(
      project.id,
      'main.cpp',
      'const char* local = "C:\\Users\\alice\\private.txt"; //comment\nconst char* url = "https://example.test/docs";\nconst char* key = "sk-sensitive-context-token";\n',
      initialDocument.contentHash,
      false
    )
    const prompt = '把 "Hello" 改成 "world，然后编译'
    const requestId = crypto.randomUUID()
    const screenshot = {
      id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png' as const, width: 320, height: 200, createdAt: new Date().toISOString()
    }
    const builder = new DesktopOpenAiContextBuilder(workspaceService, db)

    const context = await builder.build({
      requestId, source: 'screenshot', mode: 'auto', message: prompt, projectId: project.id, activeFile: 'main.cpp', screenshot
    }, requestId, 0, new AbortController().signal)

    expect(context).toMatchObject({
      protocol: 'cpppilot.context.v1', taskId: requestId, turn: 0,
      task: { prompt, source: 'screenshot', activeFile: 'main.cpp', screenshot: {
        id: screenshot.id, mimeType: 'image/png', width: 320, height: 200, bytes: expect.any(Number)
      } },
      workspace: { project: { id: project.id, name: '原始请求' }, activeFile: { path: 'main.cpp', redacted: true } },
      policy: { allowedProjectId: project.id, writesRequireApproval: true }
    })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain('C:\\Users\\alice')
    expect(serialized).not.toContain('sk-sensitive-context-token')
    expect(serialized).toContain('//comment')
    expect(serialized).toContain('https://example.test/docs')
    expect(serialized).not.toContain('apiKey')
  })

  it('includes sanitized recent project tool evidence in model memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-openai-memory-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const workspaceService = new WorkspaceService(db, join(dir, 'snapshots'))
    const workspaceRoot = join(dir, 'workspace')
    mkdirSync(workspaceRoot)
    const workspace = workspaceService.registerWorkspace(workspaceRoot)
    workspaceService.setTrust(workspace.id, true)
    const project = workspaceService.commitDraft(workspaceService.previewProject({
      mode: 'manual', workspaceId: workspace.id, name: 'Evidence project', type: 'single-file'
    }).draftId)
    const now = new Date().toISOString()
    const priorRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor' as const, mode: 'auto' as const,
      message: '修复上次的编译错误', projectId: project.id, status: 'completed' as const, steps: [],
      response: '已修复', validationSummary: '编译成功', createdAt: now, updatedAt: now, completedAt: now
    }
    db.createAgentRun(priorRun)
    db.saveToolCall({
      id: crypto.randomUUID(), runId: priorRun.id, stepId: 'tool-1', serverName: 'cpppilot-local-tools',
      toolName: 'compiler.build', risk: 'L1', parameterSummary: {}, status: 'completed', startedAt: now,
      finishedAt: now, durationMs: 1,
      result: {
        ok: true, exitCode: 0,
        summary: 'Built C:\\Users\\alice\\private.exe using sk-sensitive-memory-token',
        diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1
      }
    })
    const requestId = crypto.randomUUID()

    const context = await new DesktopOpenAiContextBuilder(workspaceService, db).build({
      requestId, source: 'editor', mode: 'auto', message: '继续处理', projectId: project.id, activeFile: 'main.cpp'
    }, requestId, 0, new AbortController().signal)

    expect(context.memory.recentEvidence).toEqual([
      expect.objectContaining({
        task: '修复上次的编译错误',
        status: 'completed',
        validationSummary: '编译成功',
        tools: [expect.objectContaining({ tool: 'compiler.build', status: 'completed', ok: true })]
      })
    ])
    const serialized = JSON.stringify(context.memory.recentEvidence)
    expect(serialized).not.toContain('C:\\Users\\alice')
    expect(serialized).not.toContain('sk-sensitive-memory-token')
    expect(serialized).not.toContain(priorRun.id)
  })

  it('creates a Responses model only when an enabled profile and key exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-responses-model-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const db = new AppDatabase(join(dir, 'data', 'app.sqlite'))
    cleanups.push(() => db.close())
    const now = new Date().toISOString()
    const profile = db.saveModelProfile({
      id: crypto.randomUUID(), name: 'Responses', baseUrl: 'https://example.test/v1', model: 'gpt-5', enabled: true,
      timeoutMs: 10_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    })
    const bodies: Record<string, any>[] = []
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ id: 'response-test', status: 'completed', output: [] })
    }) as typeof fetch
    const tools = [{
      type: 'function' as const, name: 'workspace_read_file', description: 'Read', strict: true as const,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
    }]
    const factory = new DesktopOpenAiModelFactory(db, { get: id => id === profile.id ? 'secret' : undefined }, tools, fetcher)

    const model = await factory.create(new AbortController().signal)
    await model!.respond([], new AbortController().signal)

    expect(model?.profile.id).toBe(profile.id)
    expect(bodies[0]).toMatchObject({ model: 'gpt-5', tools, store: false, parallel_tool_calls: false })
    expect(JSON.stringify(bodies[0])).not.toContain('secret')
    expect(await new DesktopOpenAiModelFactory(db, { get: () => undefined }, tools, fetcher).create(new AbortController().signal)).toBeUndefined()
  })

  it('connects to the local MCP server through a spawned stdio process', async () => {
    const worker = fileURLToPath(new URL('./fixtures/stdio-mcp-server.mjs', import.meta.url))
    const toolClient = await McpRuntimeToolClient.connectStdio({ command: process.execPath, args: [worker] })
    cleanups.push(() => toolClient.close())

    const result = await toolClient.call('workspace.list_files', { projectId: crypto.randomUUID() }, new AbortController().signal)

    expect(result).toMatchObject({ ok: true, summary: 'stdio-ready', structuredContent: { transport: 'stdio' } })
  })

  it('closes a silent stdio worker when the MCP handshake times out', async () => {
    const worker = fileURLToPath(new URL('./fixtures/silent-mcp-server.mjs', import.meta.url))
    const startedAt = Date.now()

    await expect(McpRuntimeToolClient.connectStdio(
      { command: process.execPath, args: [worker] },
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

  it('does not create learning rewards when a toolchain is bound', async () => {
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
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').achievements).toEqual([])
  })

  it('records an error without creating a review or growth entry', async () => {
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

    expect(result.ok).toBe(true)
    expect(db.listErrorBookEntries('local-user')).toHaveLength(1)
    expect(db.listReviewItems('local-user')).toEqual([])
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').xp).toBe(0)
  })

  it('does not turn a project build into a learning reward', async () => {
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

    const created = await adapter.execute('project.create', {
      workspaceId: workspace.id, mode: 'description', name: '成长项目', description: '输出 Hello'
    }, context)
    const projectId = (created.structuredContent as { projectId: string }).projectId
    const build = await adapter.execute('compiler.build', {
      runId: crypto.randomUUID(), projectId, relativePath: 'main.cpp', standard: 'c++17'
    }, context)

    expect(build.ok).toBe(true)
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').achievements).toEqual([])
  })

  it('does not turn passed cases into a learning reward', async () => {
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
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').achievements).toEqual([])
  })

  it('records one idempotent error without a review, XP reward, or achievement', async () => {
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
    expect(db.listReviewItems('local-user')).toHaveLength(0)
    expect(summary.xp).toBe(0)
    expect(summary.achievements).toEqual([])
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
    expect(db.listLearningEvents('local-user')).toEqual([])
    expect(db.getLearnerSummary('local-user').achievements).toEqual([])
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
    expect(db.listLearningEvents('local-user')).toEqual([])
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

})
