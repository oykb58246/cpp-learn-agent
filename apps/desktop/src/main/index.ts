import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AppDatabase } from '@cpp-pet/database'
import { runProcess, runtimeDiagnostics, ToolchainService, ToolExecutionError } from '@cpp-pet/cpp-local-tools'
import { DomainError, safePath, WorkspaceService } from '@cpp-pet/workspace-core'
import {
  buildRequestSchema,
  failure,
  fileRevisionSchema,
  ipc,
  programRunRequestSchema,
  programStopRequestSchema,
  projectDraftInputSchema,
  success,
  type ApiResult,
  type AppError,
  type AppSettings
} from '@cpp-pet/contracts'
import { z } from 'zod'

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let workspaceService: WorkspaceService | null = null
const toolchainService = new ToolchainService()
const activeRuns = new Map<string, AbortController>()
const buildArtifacts = new Map<string, { path: string; projectId: string; projectRoot: string; artifactName: string }>()
let stopWatching: (() => void) | null = null
if (process.env.CPP_PET_USER_DATA) app.setPath('userData', process.env.CPP_PET_USER_DATA)

const requiredServices = () => {
  if (!database || !workspaceService) throw new Error('Application services are not ready')
  return { database, workspaceService }
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
  handle(ipc.settingsUpdate, z.object({ theme: z.enum(['system', 'light', 'dark']).optional(), lastProjectId: z.string().optional(), sidebarWidth: z.number().min(220).max(360).optional() }), input => { const { database } = requiredServices(); const settings = database.updateSettings(input as Partial<AppSettings>); nativeTheme.themeSource = settings.theme; return settings })
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
  handle(ipc.projectRemove, z.object({ projectId: z.string().uuid(), deleteFiles: z.boolean() }), async input => { if (input.deleteFiles) { const result = await dialog.showMessageBox(mainWindow!, { type: 'warning', buttons: ['取消', '删除磁盘文件'], defaultId: 0, cancelId: 0, title: '删除项目文件', message: '项目目录将从磁盘删除', detail: '删除前会创建快照，但此操作仍具有风险。' }); if (result.response !== 1) return } await requiredServices().workspaceService.removeProject(input.projectId, input.deleteFiles) })
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
  handle(ipc.mockDashboard, empty, () => {
    const { database } = requiredServices()
    const activeId = database.getSettings().activeToolchainId
    const activeProfile = activeId ? database.getToolchainProfile(activeId) : undefined
    return {
      environment: [
        { id: 'vscode', label: 'VS Code', status: 'checking' as const, detail: '前往设置页执行本机环境检测' },
        { id: 'compiler', label: 'C++ 工具链', status: activeProfile ? 'ready' as const : 'checking' as const, detail: activeProfile ? `${activeProfile.family.toUpperCase()} ${activeProfile.version}` : '等待真实编译验证与绑定' },
        { id: 'agent', label: '教学 Agent', status: 'missing' as const, detail: '成员 C 阶段接入' }
      ],
      learning: { concept: '循环与边界', progress: 42, reviewCount: 3, level: 2 },
      tasks: [{ id: '1', title: '完成第一个 C++ 项目', meta: '工作区基础流程', status: 'todo' as const }, { id: '2', title: '检查循环边界错题', meta: '3 条待复习', status: 'blocked' as const }]
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1024, minHeight: 720, show: false, autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#252523', symbolColor: '#f3f3ef', height: 36 }, backgroundColor: '#1e1e1c', webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  rmSync(join(userData, 'builds'), { recursive: true, force: true })
  database = new AppDatabase(join(userData, 'data', 'cpp-pet.sqlite')); workspaceService = new WorkspaceService(database, join(userData, 'snapshots'))
  if (process.env.CPP_PET_E2E_SEED_ROOT && database.listProjects().length === 0) {
    mkdirSync(process.env.CPP_PET_E2E_SEED_ROOT, { recursive: true })
    const workspace = workspaceService.registerWorkspace(process.env.CPP_PET_E2E_SEED_ROOT)
    workspaceService.setTrust(workspace.id, true)
    const draft = workspaceService.previewProject({ mode: 'manual', workspaceId: workspace.id, name: '边界练习', type: 'single-file' })
    workspaceService.commitDraft(draft.draftId)
  }
  nativeTheme.themeSource = database.getSettings().theme; registerIpc(); createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { for (const controller of activeRuns.values()) controller.abort(); stopWatching?.(); database?.close() })
