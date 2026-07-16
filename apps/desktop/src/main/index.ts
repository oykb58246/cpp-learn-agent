import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AppDatabase } from '@cpp-pet/database'
import { runProcess, runtimeDiagnostics, ToolchainService, ToolExecutionError } from '@cpp-pet/cpp-local-tools'
import { ClangdSession } from '@cpp-pet/cpp-local-tools/language-server'
import { GdbMiSession } from '@cpp-pet/cpp-local-tools/debugger'
import { DomainError, safePath, WorkspaceService } from '@cpp-pet/workspace-core'
import {
  buildRequestSchema,
  agentRunStatusSchema,
  agentStartRequestSchema,
  approvalDecisionSchema,
  cmakeBuildRequestSchema,
  ctestRunRequestSchema,
  debugCommandRequestSchema,
  debugStartRequestSchema,
  environmentInstallRequestSchema,
  environmentOpenDownloadRequestSchema,
  failure,
  fileRevisionSchema,
  ipc,
  languageDocumentSyncSchema,
  languagePositionRequestSchema,
  languageStatusRequestSchema,
  knowledgeStatusSchema,
  modelProfileInputSchema,
  programRunRequestSchema,
  programStopRequestSchema,
  projectDraftInputSchema,
  staticAnalysisRequestSchema,
  success,
  vscodeOpenRequestSchema,
  type ApiResult,
  type AppError,
  type AppSettings,
  type EnvironmentInstallTask
} from '@cpp-pet/contracts'
import { achievementDefinitions, AgentRuntime, builtInKnowledge, KnowledgeGate, OpenAiCompatiblePlanner, transitionKnowledge } from '@cpp-pet/agent-runtime'
import { z } from 'zod'
import { createWindowOptions } from './window-options'
import { AgentHost } from './agent-host'
import { ModelSecretStore } from './model-secret-store'
import { createMcpWorkerParameters } from './mcp-worker-config'
import { petEventForRun } from './pet-events'
import {
  DatabaseRuntimeStore,
  DesktopContextBuilder,
  DesktopMcpAdapter,
  DesktopPlanner,
  McpRuntimeToolClient
} from './agent-integration'

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let workspaceService: WorkspaceService | null = null
let agentHost: AgentHost | null = null
let agentToolClient: McpRuntimeToolClient | null = null
let modelSecrets: ModelSecretStore | null = null
let agentTransport: 'starting' | 'stdio' | 'in-memory-fallback' | 'failed' = 'starting'
let agentStartupError: string | null = null
let shutdownStarted = false
let lastLearnerLevel = 1
const toolchainService = new ToolchainService()
const activeRuns = new Map<string, AbortController>()
const buildArtifacts = new Map<string, { path: string; projectId: string; projectRoot: string; artifactName: string }>()
const cmakeBuilds = new Map<string, { directory: string; sourceDirectory: string; projectId: string; configuration: 'Debug' | 'Release' }>()
const languageSessions = new Map<string, ClangdSession>()
const debugSessions = new Map<string, GdbMiSession>()
const environmentInstallTasks = new Map<string, EnvironmentInstallTask>()
let stopWatching: (() => void) | null = null
if (process.env.CPP_PET_USER_DATA) app.setPath('userData', process.env.CPP_PET_USER_DATA)

const requiredServices = () => {
  if (!database || !workspaceService) throw new Error('Application services are not ready')
  return { database, workspaceService }
}
const requiredAgentServices = () => {
  if (!agentHost || !modelSecrets) {
    if (agentStartupError) throw new ToolExecutionError('AGENT_STARTUP_FAILED', '本地 Agent 服务启动失败。', `重启应用；若问题持续，请检查 MCP Worker。${agentStartupError}`, true)
    throw new ToolExecutionError('AGENT_STARTING', '本地 Agent 服务仍在启动。', '稍候几秒后重试。', true)
  }
  return { agentHost, modelSecrets, ...requiredServices() }
}
const startRun = (runId: string): AbortController => {
  if (activeRuns.has(runId)) throw new ToolExecutionError('RUN_ID_IN_USE', '当前任务标识正在使用。', '等待当前任务结束后重试。', true)
  const controller = new AbortController()
  activeRuns.set(runId, controller)
  return controller
}
const activeToolchain = () => {
  const { database } = requiredServices()
  const id = database.getSettings().activeToolchainId
  const profile = id ? database.getToolchainProfile(id) : undefined
  if (!profile) throw new ToolExecutionError('TOOLCHAIN_NOT_BOUND', '尚未绑定可用的 C++ 工具链。', '前往设置页检测并绑定编译器。')
  return profile
}
const asError = (error: unknown): AppError => error instanceof DomainError
  ? { code: error.code, message: error.message, retryable: error.retryable, userAction: error.userAction }
  : error instanceof ToolExecutionError
    ? { code: error.code, message: error.message, retryable: error.retryable, userAction: error.userAction }
  : error instanceof Error && error.message === 'Database is in read-only recovery mode'
    ? { code: 'APP_RECOVERY_MODE', message: '数据库处于只读恢复模式。', retryable: false, userAction: '检查迁移备份并恢复数据库后再写入。' }
  : { code: 'APP_UNEXPECTED', message: error instanceof Error ? error.message : '发生未知错误。', retryable: false, userAction: '重试；若问题持续，请查看本地日志。' }
const handle = <TInput, TOutput>(channel: string, schema: z.ZodType<TInput>, action: (input: TInput) => TOutput | Promise<TOutput>) => {
  ipcMain.handle(channel, async (event, raw): Promise<ApiResult<TOutput>> => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return failure({ code: 'IPC_SENDER_REJECTED', message: '请求来源无效。', retryable: false, userAction: '从主窗口重新操作。' })
    try { return success(await action(schema.parse(raw))) } catch (error) { return failure(asError(error)) }
  })
}

function registerIpc(): void {
  const empty = z.undefined().or(z.null())
  handle(ipc.appBootstrap, empty, () => { const { database } = requiredServices(); return { version: app.getVersion(), platform: process.platform, recoveryMode: database.recoveryMode, settings: database.getSettings(), recentProjects: database.listProjects().slice(0, 8), workspaces: database.listWorkspaces(), recentEvents: database.listEvents(12) } })
  handle(ipc.appVersion, empty, () => app.getVersion())
  handle(ipc.settingsGet, empty, () => requiredServices().database.getSettings())
  handle(ipc.settingsUpdate, z.object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    lastProjectId: z.string().optional(),
    sidebarWidth: z.number().min(180).max(480).optional(),
    inspectorWidth: z.number().min(220).max(480).optional(),
    bottomPanelHeight: z.number().min(120).max(560).optional(),
    cursorStyle: z.enum(['system', 'classic', 'mascot']).optional(),
    customCursor: z.boolean().optional(),
    onboardingCompleted: z.boolean().optional(),
    onboardingStatus: z.enum(['pending', 'completed', 'skipped']).optional(),
    onboardingReminderDismissed: z.boolean().optional()
  }), input => {
    const { database } = requiredServices()
    const settings = database.updateSettings(input as Partial<AppSettings>)
    nativeTheme.themeSource = settings.theme
    applyWindowChrome(settings.theme)
    return settings
  })
  handle(ipc.workspaceSelect, empty, async () => { const result = await dialog.showOpenDialog({ title: '选择学习工作区', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; return requiredServices().workspaceService.registerWorkspace(result.filePaths[0]) })
  handle(ipc.workspaceList, empty, () => requiredServices().database.listWorkspaces())
  handle(ipc.workspaceOpen, z.object({ workspaceId: z.string().uuid() }), input => requiredServices().database.touchWorkspace(input.workspaceId))
  handle(ipc.workspaceTrust, z.object({ workspaceId: z.string().uuid(), trusted: z.boolean() }), input => requiredServices().workspaceService.setTrust(input.workspaceId, input.trusted))
  handle(ipc.workspaceRemove, z.object({ workspaceId: z.string().uuid() }), input => { requiredServices().database.removeWorkspace(input.workspaceId) })
  handle(ipc.projectPreview, projectDraftInputSchema, input => requiredServices().workspaceService.previewProject(input))
  handle(ipc.projectCreate, z.object({ draftId: z.string().uuid() }), input => requiredServices().workspaceService.commitDraft(input.draftId))
  handle(ipc.projectImportPreview, empty, async () => { const result = await dialog.showOpenDialog({ title: '导入已有 C++ 项目', properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; return requiredServices().workspaceService.previewImport(result.filePaths[0]) })
  handle(ipc.projectImport, z.object({ draftId: z.string().uuid() }), input => requiredServices().workspaceService.commitDraft(input.draftId))
  handle(ipc.projectList, z.object({ workspaceId: z.string().uuid().optional() }).optional(), input => requiredServices().database.listProjects(input?.workspaceId))
  handle(ipc.projectOpen, z.object({ projectId: z.string().uuid() }), input => { const { database, workspaceService } = requiredServices(); const project = database.touchProject(input.projectId); stopWatching?.(); stopWatching = workspaceService.watchProject(project.id, event => mainWindow?.webContents.send(ipc.workspaceChanged, event)); return project })
  handle(ipc.projectRename, z.object({ projectId: z.string().uuid(), name: z.string().min(1).max(80) }), input => requiredServices().workspaceService.renameProject(input.projectId, input.name))
  handle(ipc.projectRemove, z.object({ projectId: z.string().uuid(), deleteFiles: z.boolean() }), async input => {
    if (input.deleteFiles) {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['取消', '删除磁盘文件'],
        defaultId: 0,
        cancelId: 0,
        title: '删除项目文件',
        message: '项目目录将从磁盘删除',
        detail: '删除前会创建快照，但此操作仍具有风险。'
      })
      if (result.response !== 1) return { removed: false as const }
    }
    await requiredServices().workspaceService.removeProject(input.projectId, input.deleteFiles)
    return { removed: true as const }
  })
  handle(ipc.filesTree, z.object({ projectId: z.string().uuid() }), input => requiredServices().workspaceService.listTree(input.projectId))
  handle(ipc.filesRead, z.object({ projectId: z.string().uuid(), relativePath: z.string() }), input => requiredServices().workspaceService.readFile(input.projectId, input.relativePath))
  handle(ipc.filesWrite, fileRevisionSchema, input => requiredServices().workspaceService.writeFile(input.projectId, input.relativePath, input.content, input.expectedHash, input.createSnapshot))
  handle(ipc.filesCreate, z.object({ projectId: z.string().uuid(), relativePath: z.string(), kind: z.enum(['file', 'directory']) }), input => requiredServices().workspaceService.createEntry(input.projectId, input.relativePath, input.kind))
  handle(ipc.filesCopy, z.object({ projectId: z.string().uuid(), relativePath: z.string(), destination: z.string() }), input => requiredServices().workspaceService.copyEntry(input.projectId, input.relativePath, input.destination))
  handle(ipc.filesMove, z.object({ projectId: z.string().uuid(), relativePath: z.string(), destination: z.string() }), input => requiredServices().workspaceService.moveEntry(input.projectId, input.relativePath, input.destination))
  handle(ipc.filesRename, z.object({ projectId: z.string().uuid(), relativePath: z.string(), nextName: z.string() }), input => requiredServices().workspaceService.renameEntry(input.projectId, input.relativePath, input.nextName))
  handle(ipc.filesRemove, z.object({ projectId: z.string().uuid(), relativePath: z.string() }), async input => { const result = await dialog.showMessageBox(mainWindow!, { type: 'warning', buttons: ['取消', '删除'], defaultId: 0, cancelId: 0, message: `删除 ${input.relativePath}？`, detail: '删除前会自动创建快照。' }); if (result.response === 1) await requiredServices().workspaceService.removeEntry(input.projectId, input.relativePath) })
  handle(ipc.filesSearch, z.object({ projectId: z.string().uuid(), query: z.string().max(200) }), input => requiredServices().workspaceService.search(input.projectId, input.query))
  handle(ipc.snapshotCreate, z.object({ projectId: z.string().uuid(), label: z.string().max(100) }), input => requiredServices().workspaceService.createSnapshot(input.projectId, input.label))
  handle(ipc.snapshotList, z.object({ projectId: z.string().uuid() }), input => requiredServices().workspaceService.listSnapshots(input.projectId))
  handle(ipc.snapshotPreview, z.object({ snapshotId: z.string().uuid() }), input => requiredServices().workspaceService.previewRestore(input.snapshotId))
  handle(ipc.snapshotRestore, z.object({ snapshotId: z.string().uuid() }), async input => { const preview = requiredServices().workspaceService.previewRestore(input.snapshotId); const result = await dialog.showMessageBox(mainWindow!, { type: 'warning', buttons: ['取消', '恢复快照'], defaultId: 0, cancelId: 0, message: '恢复此快照？', detail: `将新增 ${preview.added.length}、覆盖 ${preview.overwritten.length}、删除 ${preview.deleted.length} 个文件。` }); if (result.response === 1) await requiredServices().workspaceService.restoreSnapshot(input.snapshotId) })
  handle(ipc.snapshotRemove, z.object({ snapshotId: z.string().uuid() }), input => requiredServices().workspaceService.removeSnapshot(input.snapshotId))
  handle(ipc.toolchainDetect, empty, () => toolchainService.detect())
  handle(ipc.toolchainProbe, z.object({ candidateId: z.string().min(1) }), input => toolchainService.probe(input.candidateId))
  handle(ipc.toolchainList, empty, () => {
    const { database } = requiredServices()
    const activeToolchainId = database.getSettings().activeToolchainId
    return { profiles: database.listToolchainProfiles(), ...(activeToolchainId ? { activeProfileId: activeToolchainId } : {}) }
  })
  handle(ipc.toolchainBind, z.object({ candidateId: z.string().min(1) }), async input => {
    const { database } = requiredServices()
    const profile = await toolchainService.bind(input.candidateId)
    const previous = database.listToolchainProfiles().find(item => item.compilerPath.toLowerCase() === profile.compilerPath.toLowerCase())
    database.saveToolchainProfile(profile)
    if (previous) database.removeToolchainProfile(previous.id)
    database.setActiveToolchain(profile.id)
    database.addEvent({ eventId: randomUUID(), type: 'toolchain.bound', version: 1, occurredAt: new Date().toISOString(), actor: 'user', payload: { profileId: profile.id, family: profile.family, version: profile.version } })
    return profile
  })
  handle(ipc.toolchainUnbind, z.object({ profileId: z.string().uuid() }), input => {
    const { database } = requiredServices()
    database.removeToolchainProfile(input.profileId)
    if (database.getSettings().activeToolchainId === input.profileId) database.setActiveToolchain()
    database.addEvent({ eventId: randomUUID(), type: 'toolchain.unbound', version: 1, occurredAt: new Date().toISOString(), actor: 'user', payload: { profileId: input.profileId } })
  })
  handle(ipc.toolchainHealth, z.object({ profileId: z.string().uuid() }), input => {
    const profile = requiredServices().database.getToolchainProfile(input.profileId)
    if (!profile) throw new ToolExecutionError('TOOLCHAIN_PROFILE_NOT_FOUND', '工具链配置不存在。', '重新检测并绑定工具链。')
    return toolchainService.health(profile)
  })
  handle(ipc.compilerBuild, buildRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const { root, workspace } = workspaceService.projectRoot(input.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能编译代码。', '信任工作区后再编译。')
    if (!/\.(?:cpp|cc|cxx)$/i.test(input.relativePath)) throw new ToolExecutionError('BUILD_SOURCE_UNSUPPORTED', '当前文件不是可直接编译的 C++ 源文件。', '请选择 .cpp、.cc 或 .cxx 文件。')
    const sourcePath = safePath(root, input.relativePath, false)
    const profile = activeToolchain()
    const buildId = randomUUID()
    const outputDirectory = join(app.getPath('userData'), 'builds', input.projectId, buildId)
    const controller = startRun(input.runId)
    try {
      const result = await toolchainService.buildSingleFile({
        profile,
        projectRoot: root,
        sourcePath,
        sourceRelativePath: input.relativePath,
        outputDirectory,
        standard: input.standard,
        signal: controller.signal
      })
      const artifactName = basename(result.artifactPath)
      if (result.success) buildArtifacts.set(buildId, { path: result.artifactPath, projectId: input.projectId, projectRoot: root, artifactName })
      database.addEvent({
        eventId: randomUUID(),
        type: result.success ? 'compiler.build.succeeded' : 'compiler.build.failed',
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: 'tool',
        projectId: input.projectId,
        payload: { runId: input.runId, buildId, relativePath: input.relativePath, profileId: profile.id, diagnostics: result.diagnostics.length }
      })
      return {
        runId: input.runId,
        buildId,
        projectId: input.projectId,
        relativePath: input.relativePath,
        profileId: profile.id,
        success: result.success,
        artifactName,
        process: result.process,
        diagnostics: result.diagnostics,
        builtAt: new Date().toISOString()
      }
    } finally {
      activeRuns.delete(input.runId)
    }
  })
  handle(ipc.cmakeBuild, cmakeBuildRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const { root, workspace } = workspaceService.projectRoot(input.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能构建项目。', '信任工作区后再构建。')
    if (!existsSync(join(root, 'CMakeLists.txt'))) throw new ToolExecutionError('CMAKE_PROJECT_REQUIRED', '当前项目根目录没有 CMakeLists.txt。', '选择 CMake 项目，或先创建 CMakeLists.txt。')
    const cmakePath = toolchainService.resolveToolPath('cmake')
    if (!cmakePath) throw new ToolExecutionError('CMAKE_NOT_FOUND', '未找到 CMake。', '安装 CMake 并将其加入 PATH，然后在设置页重新检测环境。')
    const profile = activeToolchain()
    const buildId = randomUUID()
    const buildDirectory = join(app.getPath('userData'), 'builds', input.projectId, buildId, 'cmake')
    const controller = startRun(input.runId)
    try {
      const result = await toolchainService.buildCmakeProject({
        profile,
        cmakePath,
        projectRoot: root,
        buildDirectory,
        standard: input.standard,
        configuration: input.configuration,
        signal: controller.signal
      })
      if (result.success) cmakeBuilds.set(buildId, { directory: buildDirectory, sourceDirectory: result.sourceDirectory, projectId: input.projectId, configuration: input.configuration })
      database.addEvent({
        eventId: randomUUID(),
        type: result.success ? 'cmake.build.succeeded' : 'cmake.build.failed',
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: 'tool',
        projectId: input.projectId,
        payload: { runId: input.runId, buildId, profileId: profile.id, configuration: input.configuration, diagnostics: result.diagnostics.length }
      })
      return {
        runId: input.runId,
        buildId,
        projectId: input.projectId,
        profileId: profile.id,
        configuration: input.configuration,
        success: result.success,
        configure: result.configure,
        ...(result.build ? { build: result.build } : {}),
        diagnostics: result.diagnostics,
        compileCommandsGenerated: result.compileCommandsGenerated,
        builtAt: new Date().toISOString()
      }
    } finally {
      activeRuns.delete(input.runId)
    }
  })
  handle(ipc.ctestRun, ctestRunRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const build = cmakeBuilds.get(input.buildId)
    if (!build || !existsSync(build.directory)) throw new ToolExecutionError('CTEST_BUILD_NOT_FOUND', 'CMake 构建目录已失效或不存在。', '重新构建 CMake 项目后再运行测试。', true)
    const { workspace } = workspaceService.projectRoot(build.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能运行测试。', '信任工作区后再运行测试。')
    const ctestPath = toolchainService.resolveToolPath('ctest')
    if (!ctestPath) throw new ToolExecutionError('CTEST_NOT_FOUND', '未找到 CTest。', '安装完整 CMake 工具并将其加入 PATH。')
    const controller = startRun(input.runId)
    try {
      const result = await toolchainService.runCtest({
        ctestPath,
        buildDirectory: build.directory,
        configuration: build.configuration,
        timeoutMs: input.timeoutMs,
        signal: controller.signal
      })
      database.addEvent({
        eventId: randomUUID(),
        type: result.success ? 'ctest.run.succeeded' : result.process.cancelled ? 'ctest.run.cancelled' : 'ctest.run.failed',
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: 'tool',
        projectId: build.projectId,
        payload: { runId: input.runId, buildId: input.buildId, total: result.total, passed: result.passed, failed: result.failed }
      })
      return { runId: input.runId, buildId: input.buildId, ...result }
    } finally {
      activeRuns.delete(input.runId)
    }
  })
  handle(ipc.analysisClangTidy, staticAnalysisRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const { root, workspace } = workspaceService.projectRoot(input.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能执行静态分析。', '信任工作区后再分析。')
    if (!/\.(?:cpp|cc|cxx|h|hpp)$/i.test(input.relativePath)) throw new ToolExecutionError('ANALYSIS_SOURCE_UNSUPPORTED', '当前文件不是可分析的 C++ 文件。', '请选择 C++ 源文件或头文件。')
    const originalSourcePath = safePath(root, input.relativePath, false)
    const clangTidyPath = toolchainService.resolveToolPath('clang-tidy')
    if (!clangTidyPath) throw new ToolExecutionError('CLANG_TIDY_NOT_FOUND', '未找到 clang-tidy。', '安装 LLVM 工具链并将 clang-tidy 加入 PATH。')
    const profile = activeToolchain()
    const latestBuild = [...cmakeBuilds.values()].reverse().find(item => item.projectId === input.projectId && existsSync(join(item.directory, 'compile_commands.json')))
    const sourcePath = latestBuild ? safePath(latestBuild.sourceDirectory, input.relativePath, false) : originalSourcePath
    const controller = startRun(input.runId)
    try {
      const result = await toolchainService.analyzeWithClangTidy({
        clangTidyPath,
        profile,
        projectRoot: latestBuild?.sourceDirectory ?? root,
        sourcePath,
        standard: input.standard,
        ...(latestBuild ? { compileCommandsDirectory: latestBuild.directory } : {}),
        signal: controller.signal
      })
      database.addEvent({
        eventId: randomUUID(),
        type: result.success ? 'analysis.clang-tidy.succeeded' : 'analysis.clang-tidy.failed',
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: 'tool',
        projectId: input.projectId,
        payload: { runId: input.runId, relativePath: input.relativePath, diagnostics: result.diagnostics.length }
      })
      return {
        runId: input.runId,
        projectId: input.projectId,
        relativePath: input.relativePath,
        success: result.success,
        process: result.process,
        diagnostics: result.diagnostics,
        analyzedAt: new Date().toISOString()
      }
    } finally {
      activeRuns.delete(input.runId)
    }
  })
  handle(ipc.vscodeOpen, vscodeOpenRequestSchema, async input => {
    const { root } = requiredServices().workspaceService.projectRoot(input.projectId)
    const vscodePath = toolchainService.resolveToolPath('vscode')
    if (!vscodePath) throw new ToolExecutionError('VSCODE_NOT_FOUND', '未找到 VS Code 命令行工具。', '安装 VS Code，并确保 code 命令可用。')
    const targetPath = input.relativePath ? safePath(root, input.relativePath, false) : undefined
    const process = await toolchainService.openInVsCode(vscodePath, root, targetPath ? { path: targetPath, ...(input.line ? { line: input.line } : {}), ...(input.column ? { column: input.column } : {}) } : undefined)
    return { success: process.exitCode === 0 && !process.timedOut && !process.cancelled, process }
  })
  handle(ipc.environmentOpenDownload, environmentOpenDownloadRequestSchema, async input => {
    const urls = {
      msys2: 'https://www.msys2.org/',
      llvm: 'https://llvm.org/',
      cmake: 'https://cmake.org/download/',
      vscode: 'https://code.visualstudio.com/download',
      'visual-studio': 'https://visualstudio.microsoft.com/downloads/'
    } as const
    await shell.openExternal(urls[input.target])
  })
  handle(ipc.environmentInstallerStatus, empty, async () => {
    if (process.env.CPP_PET_E2E_INSTALLER === 'mock') return { available: true, manager: 'winget' as const, version: 'mock' }
    if (process.platform !== 'win32') return { available: false, manager: 'winget' as const, reason: '当前自动安装引导仅支持 Windows。' }
    const result = await runProcess('winget.exe', ['--version'], { timeoutMs: 5_000, maxOutputBytes: 16 * 1024 })
    const version = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    return result.exitCode === 0
      ? { available: true, manager: 'winget' as const, ...(version ? { version } : {}) }
      : { available: false, manager: 'winget' as const, reason: '未找到可运行的 WinGet，请使用官方下载入口。' }
  })
  handle(ipc.environmentInstallTasks, empty, () => [...environmentInstallTasks.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
  handle(ipc.environmentInstall, environmentInstallRequestSchema, async input => {
    if ([...environmentInstallTasks.values()].some(task => task.status === 'running')) {
      throw new ToolExecutionError('ENVIRONMENT_INSTALL_IN_PROGRESS', '已有环境安装任务正在运行。', '等待当前安装结束后再安装其他组件。', true)
    }
    const packages = {
      msys2: { label: 'MSYS2', packageId: 'MSYS2.MSYS2' },
      llvm: { label: 'LLVM', packageId: 'LLVM.LLVM' },
      cmake: { label: 'CMake', packageId: 'Kitware.CMake' },
      vscode: { label: 'Visual Studio Code', packageId: 'Microsoft.VisualStudioCode' }
    } as const
    const target = packages[input.target]
    if (process.env.CPP_PET_E2E_INSTALLER === 'mock') {
      const task: EnvironmentInstallTask = {
        taskId: randomUUID(),
        target: input.target,
        packageId: target.packageId,
        status: 'running',
        startedAt: new Date().toISOString()
      }
      environmentInstallTasks.set(task.taskId, task)
      mainWindow?.webContents.send(ipc.environmentInstallChanged, task)
      setTimeout(() => {
        const completed: EnvironmentInstallTask = {
          ...task,
          status: 'succeeded',
          finishedAt: new Date().toISOString(),
          exitCode: 0
        }
        environmentInstallTasks.set(task.taskId, completed)
        mainWindow?.webContents.send(ipc.environmentInstallChanged, completed)
      }, 50)
      return { launched: true, target: input.target, packageId: target.packageId, task }
    }
    const status = await runProcess('winget.exe', ['--version'], { timeoutMs: 5_000, maxOutputBytes: 16 * 1024 })
    if (status.exitCode !== 0) throw new ToolExecutionError('WINGET_NOT_AVAILABLE', '当前系统无法运行 WinGet。', '使用“官方下载”安装，完成后返回向导重新检测。')
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      buttons: ['取消', '打开安装终端'],
      defaultId: 1,
      cancelId: 0,
      title: `安装 ${target.label}`,
      message: `准备通过 WinGet 安装 ${target.label}`,
      detail: `应用将打开一个可见的 PowerShell 窗口并运行固定软件包 ${target.packageId}。你可以查看安装过程、处理系统授权或随时关闭终端。`
    })
    if (confirmation.response !== 1) return { launched: false, target: input.target, packageId: target.packageId }
    const task: EnvironmentInstallTask = {
      taskId: randomUUID(),
      target: input.target,
      packageId: target.packageId,
      status: 'running',
      startedAt: new Date().toISOString()
    }
    environmentInstallTasks.set(task.taskId, task)
    if (environmentInstallTasks.size > 20) {
      const oldest = [...environmentInstallTasks.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]
      if (oldest && oldest.status !== 'running') environmentInstallTasks.delete(oldest.taskId)
    }
    const command = [
      `Write-Host 'CppPilot 正在启动 ${target.label} 安装...' -ForegroundColor Cyan`,
      `$exitCode = 1`,
      `try { winget install --id '${target.packageId}' --exact --source winget --interactive --accept-source-agreements --accept-package-agreements; $exitCode = $LASTEXITCODE } catch { Write-Error $_; $exitCode = 1 }`,
      `if ($exitCode -eq 0) { Write-Host '安装完成，CppPilot 将自动重新检测环境。' -ForegroundColor Green } else { Write-Host \"安装未成功，退出码: $exitCode\" -ForegroundColor Red }`,
      `Start-Sleep -Seconds 3`,
      `exit $exitCode`
    ].join('; ')
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    let finished = false
    const finishTask = (status: EnvironmentInstallTask['status'], exitCode: number | null) => {
      if (finished) return
      finished = true
      const completed: EnvironmentInstallTask = {
        ...task,
        status,
        finishedAt: new Date().toISOString(),
        exitCode
      }
      environmentInstallTasks.set(task.taskId, completed)
      mainWindow?.webContents.send(ipc.environmentInstallChanged, completed)
    }
    child.once('error', () => finishTask('failed', null))
    child.once('close', code => finishTask(code === 0 ? 'succeeded' : 'failed', code))
    mainWindow?.webContents.send(ipc.environmentInstallChanged, task)
    child.unref()
    return { launched: true, target: input.target, packageId: target.packageId, task }
  })
  handle(ipc.languageStatus, languageStatusRequestSchema, input => {
    requiredServices().workspaceService.projectRoot(input.projectId)
    const profile = activeToolchain()
    const serverPath = profile.languageServerPath ?? toolchainService.resolveToolPath('clangd')
    return serverPath
      ? { available: true, serverPath }
      : { available: false, reason: '未找到 clangd。安装 LLVM 并重新绑定工具链后可启用语义补全、悬停和定义跳转。' }
  })
  handle(ipc.languageSync, languageDocumentSyncSchema, async input => {
    const { root } = requiredServices().workspaceService.projectRoot(input.projectId)
    const absolutePath = safePath(root, input.relativePath, false)
    const profile = activeToolchain()
    const serverPath = profile.languageServerPath ?? toolchainService.resolveToolPath('clangd')
    if (!serverPath) throw new ToolExecutionError('CLANGD_NOT_FOUND', '未找到 clangd 语言服务。', '安装 LLVM 并重新检测、绑定工具链。')
    let session = languageSessions.get(input.projectId)
    if (!session) {
      const latestBuild = [...cmakeBuilds.values()].reverse().find(item => item.projectId === input.projectId && existsSync(join(item.directory, 'compile_commands.json')))
      session = new ClangdSession(serverPath, input.projectId, root, latestBuild?.directory, (relativePath, diagnostics) => {
        mainWindow?.webContents.send(ipc.languageDiagnostics, { projectId: input.projectId, relativePath, diagnostics })
      })
      languageSessions.set(input.projectId, session)
    }
    await session.sync(input.relativePath, absolutePath, input.content, input.version)
  })
  handle(ipc.languageCompletion, languagePositionRequestSchema, async input => {
    const { root } = requiredServices().workspaceService.projectRoot(input.projectId)
    const path = safePath(root, input.relativePath, false)
    const session = languageSessions.get(input.projectId)
    if (!session) throw new ToolExecutionError('LANGUAGE_SESSION_NOT_READY', '当前文件尚未连接 clangd。', '等待语言服务初始化后重试。', true)
    return session.completion(path, { line: input.line - 1, character: input.column - 1 })
  })
  handle(ipc.languageHover, languagePositionRequestSchema, async input => {
    const { root } = requiredServices().workspaceService.projectRoot(input.projectId)
    const path = safePath(root, input.relativePath, false)
    const session = languageSessions.get(input.projectId)
    if (!session) return null
    return session.hover(path, { line: input.line - 1, character: input.column - 1 })
  })
  handle(ipc.languageDefinition, languagePositionRequestSchema, async input => {
    const { root } = requiredServices().workspaceService.projectRoot(input.projectId)
    const path = safePath(root, input.relativePath, false)
    const session = languageSessions.get(input.projectId)
    if (!session) return null
    return session.definition(path, { line: input.line - 1, character: input.column - 1 })
  })
  handle(ipc.debugStart, debugStartRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const { root, workspace } = workspaceService.projectRoot(input.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能启动调试。', '信任工作区后再调试。')
    if (!/\.(?:cpp|cc|cxx)$/i.test(input.relativePath)) throw new ToolExecutionError('DEBUG_SOURCE_UNSUPPORTED', '当前文件不是可调试的 C++ 源文件。', '请选择 .cpp、.cc 或 .cxx 文件。')
    const profile = activeToolchain()
    const debuggerPath = profile.debuggerPath
    if (!debuggerPath || !existsSync(debuggerPath)) throw new ToolExecutionError('DEBUGGER_NOT_FOUND', '当前工具链没有可用调试器。', '安装 GDB 或 LLDB，并重新绑定工具链。')
    if (profile.family === 'msvc') throw new ToolExecutionError('DEBUGGER_BACKEND_UNSUPPORTED', '当前版本尚未接入 MSVC 调试后端。', '选择带 GDB 的 GCC 或带 LLDB 的 Clang 工具链。')
    const sourcePath = safePath(root, input.relativePath, false)
    const sessionId = randomUUID()
    const outputDirectory = join(app.getPath('userData'), 'builds', input.projectId, sessionId, 'debug')
    const stagedSourcePath = join(outputDirectory, 'debug-source.cpp')
    mkdirSync(outputDirectory, { recursive: true })
    copyFileSync(sourcePath, stagedSourcePath)
    const build = await toolchainService.buildSingleFile({
      profile,
      projectRoot: root,
      sourcePath: stagedSourcePath,
      sourceRelativePath: input.relativePath,
      outputDirectory,
      standard: input.standard,
      debugSymbols: true,
      includeDirectories: [root]
    })
    if (!build.success) return {
      sessionId,
      projectId: input.projectId,
      status: 'error' as const,
      reason: '调试构建失败。',
      frames: [],
      variables: [],
      output: `${build.process.stdout}\n${build.process.stderr}`.trim(),
      diagnostics: build.diagnostics
    }
    const session = new GdbMiSession(
      sessionId,
      debuggerPath,
      build.artifactPath,
      input.projectId,
      root,
      new Map([[stagedSourcePath, input.relativePath]])
    )
    debugSessions.set(sessionId, session)
    try {
      const state = await session.initialize(input.breakpoints
        .filter(item => item.relativePath.replaceAll('\\', '/').toLowerCase() === input.relativePath.replaceAll('\\', '/').toLowerCase())
        .map(item => ({ path: stagedSourcePath.replaceAll('\\', '/'), line: item.line })))
      database.addEvent({ eventId: randomUUID(), type: 'debug.session.started', version: 1, occurredAt: new Date().toISOString(), actor: 'tool', projectId: input.projectId, payload: { sessionId, relativePath: input.relativePath, breakpoints: input.breakpoints.length } })
      return state
    } catch (error) {
      debugSessions.delete(sessionId)
      throw error
    }
  })
  handle(ipc.debugCommand, debugCommandRequestSchema, async input => {
    const session = debugSessions.get(input.sessionId)
    if (!session) throw new ToolExecutionError('DEBUG_SESSION_NOT_FOUND', '调试会话不存在或已结束。', '重新启动调试。', true)
    const state = await session.execute(input.command)
    if (state.status === 'exited' || state.status === 'error') {
      await session.dispose()
      debugSessions.delete(input.sessionId)
    }
    return state
  })
  handle(ipc.programRun, programRunRequestSchema, async input => {
    const { database, workspaceService } = requiredServices()
    const artifact = buildArtifacts.get(input.buildId)
    if (!artifact || !existsSync(artifact.path)) throw new ToolExecutionError('RUN_BUILD_NOT_FOUND', '编译产物已失效或不存在。', '重新编译当前文件后再运行。', true)
    const { workspace } = workspaceService.projectRoot(artifact.projectId)
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读，不能运行程序。', '信任工作区后再运行。')
    const controller = startRun(input.runId)
    try {
      const process = await runProcess(artifact.path, [], {
        cwd: artifact.projectRoot,
        input: input.input,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: 512 * 1024,
        signal: controller.signal
      })
      const diagnostics = runtimeDiagnostics(process)
      const result = { runId: input.runId, buildId: input.buildId, success: process.exitCode === 0 && !process.timedOut && !process.cancelled, process, diagnostics }
      database.addEvent({
        eventId: randomUUID(),
        type: result.success ? 'program.run.succeeded' : process.cancelled ? 'program.run.cancelled' : 'program.run.failed',
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: 'tool',
        projectId: artifact.projectId,
        payload: { runId: input.runId, buildId: input.buildId, exitCode: process.exitCode, timedOut: process.timedOut }
      })
      return result
    } finally {
      activeRuns.delete(input.runId)
    }
  })
  handle(ipc.programStop, programStopRequestSchema, input => {
    const controller = activeRuns.get(input.runId)
    controller?.abort()
    return { runId: input.runId, stopped: Boolean(controller) }
  })
  handle(ipc.agentStart, agentStartRequestSchema, input => requiredAgentServices().agentHost.start(input))
  handle(ipc.agentGet, z.object({ runId: z.string().uuid() }), input => {
    const run = requiredAgentServices().agentHost.get(input.runId)
    if (!run) throw new ToolExecutionError('AGENT_RUN_NOT_FOUND', 'Agent 记录不存在。', '刷新 Agent 记录列表。')
    return run
  })
  handle(ipc.agentList, z.object({
    status: agentRunStatusSchema.optional(),
    projectId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50)
  }).optional(), input => requiredServices().database.listAgentRuns(input ? {
    ...(input.status ? { status: input.status } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    limit: input.limit
  } : {}))
  handle(ipc.agentCancel, z.object({ runId: z.string().uuid() }), input => requiredAgentServices().agentHost.cancel(input.runId))
  handle(ipc.approvalDecide, approvalDecisionSchema, input => requiredAgentServices().agentHost.decide(input))
  handle(ipc.learningCatalog, empty, () => requiredServices().database.listKnowledgeNodes())
  handle(ipc.learningKnowledge, z.object({ userId: z.string().min(1).max(100).default('local-user') }).optional(), input => requiredServices().database.listLearnerKnowledge(input?.userId ?? 'local-user'))
  handle(ipc.learningUpdateKnowledge, z.object({
    userId: z.string().min(1).max(100).default('local-user'),
    conceptId: z.string().min(1).max(100),
    status: knowledgeStatusSchema
  }), input => {
    if (input.status === 'verified') throw new DomainError('LEARNING_VERIFICATION_REQUIRED', '已验证状态只能由工具证据产生。', '先完成编译、测试或复习验证。')
    const now = new Date().toISOString()
    const { database } = requiredServices()
    try {
      const state = transitionKnowledge(input.userId, builtInKnowledge, database.listLearnerKnowledge(input.userId), input.conceptId, input.status, now)
      return database.upsertLearnerKnowledge({ ...state, lastEvidenceId: `user:${randomUUID()}` })
    } catch (error) {
      throw new DomainError('KNOWLEDGE_PREREQUISITE_REQUIRED', error instanceof Error ? error.message : String(error), '先完成知识树中标出的前置节点。')
    }
  })
  handle(ipc.learningErrors, z.object({
    userId: z.string().min(1).max(100).default('local-user'),
    status: z.enum(['open', 'resolved', 'reviewing']).optional()
  }).optional(), input => requiredServices().database.listErrorBookEntries(input?.userId ?? 'local-user', input?.status))
  handle(ipc.learningReviews, z.object({ userId: z.string().min(1).max(100).default('local-user'), dueOnly: z.boolean().default(false) }).optional(), input => requiredServices().database.listReviewItems(input?.userId ?? 'local-user', input?.dueOnly ?? false))
  handle(ipc.learningSummary, z.object({ userId: z.string().min(1).max(100).default('local-user') }).optional(), input => requiredServices().database.getLearnerSummary(input?.userId ?? 'local-user'))
  handle(ipc.modelList, empty, () => requiredServices().database.listModelProfiles())
  handle(ipc.modelSave, modelProfileInputSchema, input => {
    const { database, modelSecrets } = requiredAgentServices()
    const existing = input.id ? database.getModelProfile(input.id) : undefined
    const now = new Date().toISOString()
    const id = input.id ?? randomUUID()
    if (input.apiKey) modelSecrets.set(id, input.apiKey)
    const profile = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      enabled: input.enabled,
      timeoutMs: input.timeoutMs,
      apiKeyConfigured: modelSecrets.has(id),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    return database.saveModelProfile(profile)
  })
  handle(ipc.modelRemove, z.object({ profileId: z.string().uuid() }), input => {
    const { database, modelSecrets } = requiredAgentServices()
    modelSecrets.clear(input.profileId)
    database.removeModelProfile(input.profileId)
  })
  handle(ipc.modelClearKey, z.object({ profileId: z.string().uuid() }), input => {
    const { database, modelSecrets } = requiredAgentServices()
    const profile = database.getModelProfile(input.profileId)
    if (!profile) throw new ToolExecutionError('MODEL_PROFILE_NOT_FOUND', '模型配置不存在。', '刷新模型配置列表。')
    modelSecrets.clear(input.profileId)
    return database.saveModelProfile({ ...profile, apiKeyConfigured: false, updatedAt: new Date().toISOString() })
  })
  handle(ipc.modelTest, z.object({ profileId: z.string().uuid() }), async input => {
    const { database, modelSecrets } = requiredAgentServices()
    const profile = database.getModelProfile(input.profileId)
    const apiKey = modelSecrets.get(input.profileId)
    if (!profile || !apiKey) throw new ToolExecutionError('MODEL_NOT_CONFIGURED', '模型配置或 API Key 不完整。', '保存模型地址、模型名和 API Key。')
    const started = Date.now()
    await new OpenAiCompatiblePlanner({ profile, apiKey }).plan({ requestId: randomUUID(), source: 'system', mode: 'chat', message: '连接测试' }, { requestId: randomUUID(), sources: [], conceptIds: [], tokenEstimate: 0, truncated: false }, new AbortController().signal)
    return { ok: true, latencyMs: Date.now() - started, detail: '模型返回了有效结构化计划。' }
  })
  handle(ipc.mockDashboard, empty, () => {
    const { database } = requiredServices()
    const activeId = database.getSettings().activeToolchainId
    const activeProfile = activeId ? database.getToolchainProfile(activeId) : undefined
    return {
      environment: [
        { id: 'vscode', label: 'VS Code', status: 'checking' as const, detail: '前往设置页执行本机环境检测' },
        { id: 'compiler', label: 'C++ 工具链', status: activeProfile ? 'ready' as const : 'checking' as const, detail: activeProfile ? `${activeProfile.family.toUpperCase()} ${activeProfile.version}` : '等待真实编译验证与绑定' },
        {
          id: 'agent',
          label: '教学 Agent',
          status: agentHost ? 'ready' as const : agentTransport === 'failed' ? 'missing' as const : 'checking' as const,
          detail: agentHost
            ? agentTransport === 'stdio' ? 'Agent Runtime 与 stdio MCP 已连接' : 'stdio MCP 不可用，已切换进程内本地工具通道'
            : agentStartupError ?? '正在连接本地 Agent 服务'
        }
      ],
      learning: { concept: '循环与边界', progress: 42, reviewCount: 3, level: 2 },
      tasks: [{ id: '1', title: '完成第一个 C++ 项目', meta: '工作区基础流程', status: 'todo' as const }, { id: '2', title: '检查循环边界错题', meta: '3 条待复习', status: 'blocked' as const }]
    }
  })
}

function resolveIsDark(theme: AppSettings['theme']): boolean {
  if (theme === 'light') return false
  if (theme === 'dark') return true
  return nativeTheme.shouldUseDarkColors
}

function windowChrome(theme: AppSettings['theme']) {
  const dark = resolveIsDark(theme)
  return {
    dark,
    backgroundColor: dark ? '#121820' : '#f5f7fb',
    titleBarOverlay: dark
      ? { color: '#1a2230', symbolColor: '#eef3fb', height: 48 }
      : { color: '#ffffff', symbolColor: '#142033', height: 48 }
  }
}

function applyWindowChrome(theme: AppSettings['theme'] = database?.getSettings().theme ?? 'system'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const chrome = windowChrome(theme)
  mainWindow.setTitleBarOverlay(chrome.titleBarOverlay)
  mainWindow.setBackgroundColor(chrome.backgroundColor)
}

function createWindow(): void {
  const theme = database?.getSettings().theme ?? 'system'
  const chrome = windowChrome(theme)
  const iconPath = join(__dirname, '../../build/icon.ico')
  mainWindow = new BrowserWindow(createWindowOptions({
    iconPath,
    iconExists: existsSync(iconPath),
    titleBarColor: chrome.titleBarOverlay.color,
    symbolColor: chrome.titleBarOverlay.symbolColor,
    backgroundColor: chrome.backgroundColor,
    preloadPath: join(__dirname, '../preload/index.cjs')
  }))
  mainWindow.once('ready-to-show', () => {
    applyWindowChrome(theme)
    mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  rmSync(join(userData, 'builds'), { recursive: true, force: true })
  database = new AppDatabase(join(userData, 'data', 'cpp-pet.sqlite')); workspaceService = new WorkspaceService(database, join(userData, 'snapshots'))
  if (!database.recoveryMode) database.recoverInterruptedAgentRuns()
  if (process.env.CPP_PET_E2E_SEED_ROOT && database.listProjects().length === 0) {
    mkdirSync(process.env.CPP_PET_E2E_SEED_ROOT, { recursive: true })
    const workspace = workspaceService.registerWorkspace(process.env.CPP_PET_E2E_SEED_ROOT)
    workspaceService.setTrust(workspace.id, true)
    const draft = workspaceService.previewProject({ mode: 'manual', workspaceId: workspace.id, name: '边界练习', type: 'single-file' })
    workspaceService.commitDraft(draft.draftId)
  }
  database.seedKnowledge(builtInKnowledge)
  database.seedAchievementDefinitions(achievementDefinitions)
  lastLearnerLevel = database.getLearnerSummary('local-user').level
  modelSecrets = new ModelSecretStore(join(userData, 'data', 'model-secrets.json'), {
    encryptString(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new ToolExecutionError('SAFE_STORAGE_UNAVAILABLE', '当前系统无法安全保存 API Key。', '使用支持系统密钥保护的 Windows 用户会话。')
      return safeStorage.encryptString(value)
    },
    decryptString(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new ToolExecutionError('SAFE_STORAGE_UNAVAILABLE', '当前系统无法解密 API Key。', '使用保存该密钥的 Windows 用户会话。')
      return safeStorage.decryptString(value)
    }
  })
  nativeTheme.themeSource = database.getSettings().theme
  registerIpc()
  createWindow()
  nativeTheme.on('updated', () => applyWindowChrome())
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  try {
    agentToolClient = await McpRuntimeToolClient.connectStdio(createMcpWorkerParameters(process.execPath, join(__dirname, 'mcp-worker.js'), userData))
    agentTransport = 'stdio'
  } catch (error) {
    agentStartupError = error instanceof Error ? error.message : String(error)
    try {
      agentToolClient = await McpRuntimeToolClient.connect(new DesktopMcpAdapter({
        db: database,
        workspaceService,
        toolchainService,
        buildRoot: join(userData, 'builds', 'agent-fallback')
      }))
      agentTransport = 'in-memory-fallback'
    } catch (fallbackError) {
      agentTransport = 'failed'
      agentStartupError = `${agentStartupError}; ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      return
    }
  }
  const runtime = new AgentRuntime({
    store: new DatabaseRuntimeStore(database),
    contextBuilder: new DesktopContextBuilder(workspaceService, database),
    planner: new DesktopPlanner(database, modelSecrets!),
    toolClient: agentToolClient,
    knowledgeGate: new KnowledgeGate(builtInKnowledge)
  })
  agentHost = new AgentHost(runtime)
  agentHost.onChanged(run => {
    mainWindow?.webContents.send(ipc.agentChanged, run)
    const currentLevel = database?.getLearnerSummary('local-user').level ?? lastLearnerLevel
    mainWindow?.webContents.send(ipc.petChanged, petEventForRun(run, lastLearnerLevel, currentLevel))
    lastLearnerLevel = currentLevel
  })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => {
  if (shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  for (const controller of activeRuns.values()) controller.abort()
  void (async () => {
    await Promise.allSettled(agentHost ? [agentHost.shutdown()] : [])
    await Promise.allSettled([
      ...(agentToolClient ? [agentToolClient.close()] : []),
      ...[...languageSessions.values()].map(session => session.dispose()),
      ...[...debugSessions.values()].map(session => session.dispose())
    ])
    stopWatching?.()
    database?.close()
  })().finally(() => app.quit())
})
