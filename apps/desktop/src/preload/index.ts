import { contextBridge, ipcRenderer } from 'electron'
import type { CppPetApi, WorkspaceChangedEvent } from '@cpp-pet/contracts'
import { ipc } from '@cpp-pet/contracts/ipc'

const invoke = <T>(channel: string, input?: unknown) => ipcRenderer.invoke(channel, input) as Promise<T>
const api: CppPetApi = {
  app: { getBootstrap: () => invoke(ipc.appBootstrap), getVersion: () => invoke(ipc.appVersion) },
  settings: { get: () => invoke(ipc.settingsGet), update: input => invoke(ipc.settingsUpdate, input) },
  workspace: {
    selectRoot: () => invoke(ipc.workspaceSelect), list: () => invoke(ipc.workspaceList), open: input => invoke(ipc.workspaceOpen, input),
    setTrust: input => invoke(ipc.workspaceTrust, input), remove: input => invoke(ipc.workspaceRemove, input),
    onChanged: listener => { const wrapped = (_: unknown, event: WorkspaceChangedEvent) => listener(event); ipcRenderer.on(ipc.workspaceChanged, wrapped); return () => ipcRenderer.removeListener(ipc.workspaceChanged, wrapped) }
  },
  project: {
    preview: input => invoke(ipc.projectPreview, input), create: input => invoke(ipc.projectCreate, input),
    previewImport: () => invoke(ipc.projectImportPreview), import: input => invoke(ipc.projectImport, input),
    list: input => invoke(ipc.projectList, input),
    open: input => invoke(ipc.projectOpen, input),
    rename: input => invoke(ipc.projectRename, input),
    remove: input => invoke(ipc.projectRemove, input)
  },
  files: {
    listTree: input => invoke(ipc.filesTree, input), read: input => invoke(ipc.filesRead, input), write: input => invoke(ipc.filesWrite, input),
    create: input => invoke(ipc.filesCreate, input), copy: input => invoke(ipc.filesCopy, input), move: input => invoke(ipc.filesMove, input),
    rename: input => invoke(ipc.filesRename, input), remove: input => invoke(ipc.filesRemove, input), search: input => invoke(ipc.filesSearch, input)
  },
  snapshots: {
    create: input => invoke(ipc.snapshotCreate, input), list: input => invoke(ipc.snapshotList, input),
    previewRestore: input => invoke(ipc.snapshotPreview, input), restore: input => invoke(ipc.snapshotRestore, input), remove: input => invoke(ipc.snapshotRemove, input)
  },
  toolchains: {
    detect: () => invoke(ipc.toolchainDetect), probe: input => invoke(ipc.toolchainProbe, input),
    list: () => invoke(ipc.toolchainList), bind: input => invoke(ipc.toolchainBind, input),
    unbind: input => invoke(ipc.toolchainUnbind, input), health: input => invoke(ipc.toolchainHealth, input)
  },
  compiler: { build: input => invoke(ipc.compilerBuild, input) },
  cmake: { build: input => invoke(ipc.cmakeBuild, input) },
  ctest: { run: input => invoke(ipc.ctestRun, input) },
  analysis: { clangTidy: input => invoke(ipc.analysisClangTidy, input) },
  vscode: { open: input => invoke(ipc.vscodeOpen, input) },
  environment: {
    openDownload: input => invoke(ipc.environmentOpenDownload, input),
    installerStatus: () => invoke(ipc.environmentInstallerStatus),
    install: input => invoke(ipc.environmentInstall, input),
    installTasks: () => invoke(ipc.environmentInstallTasks),
    onInstallChanged: listener => {
      const wrapped = (_: unknown, task: Parameters<typeof listener>[0]) => listener(task)
      ipcRenderer.on(ipc.environmentInstallChanged, wrapped)
      return () => ipcRenderer.removeListener(ipc.environmentInstallChanged, wrapped)
    }
  },
  language: {
    status: input => invoke(ipc.languageStatus, input),
    sync: input => invoke(ipc.languageSync, input),
    completion: input => invoke(ipc.languageCompletion, input),
    hover: input => invoke(ipc.languageHover, input),
    definition: input => invoke(ipc.languageDefinition, input),
    onDiagnostics: listener => {
      const wrapped = (_: unknown, event: Parameters<typeof listener>[0]) => listener(event)
      ipcRenderer.on(ipc.languageDiagnostics, wrapped)
      return () => ipcRenderer.removeListener(ipc.languageDiagnostics, wrapped)
    }
  },
  debug: {
    start: input => invoke(ipc.debugStart, input),
    command: input => invoke(ipc.debugCommand, input)
  },
  program: {
    run: input => invoke(ipc.programRun, input),
    stop: input => invoke(ipc.programStop, input)
  },
  diagnostics: {
    listActive: input => invoke(ipc.diagnosticsListActive, input),
    acknowledge: input => invoke(ipc.diagnosticsAcknowledge, input),
    onChanged: listener => {
      const wrapped = (_: unknown, event: Parameters<typeof listener>[0]) => listener(event)
      ipcRenderer.on(ipc.diagnosticsChanged, wrapped)
      return () => ipcRenderer.removeListener(ipc.diagnosticsChanged, wrapped)
    }
  },
  conversations: {
    list: input => invoke(ipc.conversationsList, input),
    create: input => invoke(ipc.conversationsCreate, input),
    archive: input => invoke(ipc.conversationsArchive, input),
    messages: input => invoke(ipc.conversationsMessages, input),
    submitAgent: input => invoke(ipc.conversationsAgentSubmit, input),
    onChanged: listener => {
      const wrapped = (_: unknown, event: Parameters<typeof listener>[0]) => listener(event)
      ipcRenderer.on(ipc.conversationsChanged, wrapped)
      return () => ipcRenderer.removeListener(ipc.conversationsChanged, wrapped)
    }
  },
  agent: {
    start: input => invoke(ipc.agentStart, input),
    continue: input => invoke(ipc.agentContinue, input),
    get: input => invoke(ipc.agentGet, input),
    list: input => invoke(ipc.agentList, input),
    cancel: input => invoke(ipc.agentCancel, input),
    onChanged: listener => {
      const wrapped = (_: unknown, run: Parameters<typeof listener>[0]) => listener(run)
      ipcRenderer.on(ipc.agentChanged, wrapped)
      return () => ipcRenderer.removeListener(ipc.agentChanged, wrapped)
    }
  },
  approvals: {
    decide: input => invoke(ipc.approvalDecide, input)
  },
  learning: {
    catalog: () => invoke(ipc.learningCatalog),
    knowledge: input => invoke(ipc.learningKnowledge, input),
    updateKnowledge: input => invoke(ipc.learningUpdateKnowledge, input),
    background: input => invoke(ipc.learningBackgroundGet, input),
    saveBackground: input => invoke(ipc.learningBackgroundSave, input),
    errors: input => invoke(ipc.learningErrors, input),
    reviews: input => invoke(ipc.learningReviews, input),
    summary: input => invoke(ipc.learningSummary, input)
  },
  model: {
    list: () => invoke(ipc.modelList),
    save: input => invoke(ipc.modelSave, input),
    remove: input => invoke(ipc.modelRemove, input),
    clearKey: input => invoke(ipc.modelClearKey, input),
    test: input => invoke(ipc.modelTest, input)
  },
  pet: {
    onEvent: listener => {
      const wrapped = (_: unknown, event: Parameters<typeof listener>[0]) => listener(event)
      ipcRenderer.on(ipc.petChanged, wrapped)
      return () => ipcRenderer.removeListener(ipc.petChanged, wrapped)
    }
  },
  mocks: { getDashboard: () => invoke(ipc.mockDashboard) }
}
contextBridge.exposeInMainWorld('cppPet', api)
