import { z } from 'zod'
import type {
  BuildRequest,
  BuildResult,
  CmakeBuildRequest,
  CmakeBuildResult,
  CtestRunRequest,
  CtestRunResult,
  DebugCommandRequest,
  DebugSessionState,
  DebugStartRequest,
  EnvironmentInstallRequest,
  EnvironmentInstallResult,
  EnvironmentInstallTask,
  EnvironmentInstallerStatus,
  EnvironmentOpenDownloadRequest,
  LanguageCompletion,
  LanguageDefinition,
  LanguageDiagnosticsEvent,
  LanguageDocumentSync,
  LanguageHover,
  LanguagePositionRequest,
  LanguageStatus,
  LanguageStatusRequest,
  ProgramRunRequest,
  ProgramRunResult,
  ProgramStopRequest,
  ProgramStopResult,
  StaticAnalysisRequest,
  StaticAnalysisResult,
  ToolchainBindingState,
  ToolchainDetectionResult,
  ToolchainHealthResult,
  ToolchainProbeResult,
  ToolchainProfile,
  VscodeOpenRequest,
  VscodeOpenResult
} from './future'
import type {
  AgentRun,
  AgentRunDetail,
  AgentRunStatus,
  AgentContinueRequest,
  AgentStartRequest,
  ApprovalDecision,
  ModelProfile,
  ModelProfileInput
} from './agent'
import type { AppNavigationEvent, PetChatRequest, PetChatResult, PetCustomAssetCreateInput, PetCustomAssetMutation, PetCustomAssetRename, PetDragWindowRequest, PetEvent, PetSettings, PetWindowState, PracticeCatalog, PracticeOjImportInput, PracticeOjImportResult, PracticeProjectCompleteRequest, PracticeProjectCompleteResult, PracticeSubmissionRequest, PracticeSubmissionResult, ScreenshotCaptureRequest, ScreenshotCaptureSubmission, ScreenshotPendingCapture, ScreenshotSubmittedEvent } from './future'
import type {
  BackgroundProfile,
  BackgroundProfileInput,
  ErrorBookEntry,
  KnowledgeNode,
  KnowledgeStatus,
  LearnerKnowledge,
  LearnerSummary,
  ReviewItem
} from './learning'
import type {
  AgentConversation,
  AgentMessage,
  ConversationArchiveInput,
  ConversationChangedEvent,
  ConversationCreateInput,
  ConversationMessageDelta,
  ConversationMessagesInput,
  ConversationRetryInput,
  ConversationSendInput,
  ConversationSendResult,
  ConversationAgentSubmitResult,
  ConversationStopInput,
  DiagnosticInboxChangedEvent
} from './conversation'
export { ipc } from './ipc'
export * from './future'
export * from './agent'
export * from './learning'
export * from './conversation'
export * from './agent-protocol'
export * from './openai-agent'

export const themeSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof themeSchema>
export const cursorStyleSchema = z.enum(['system', 'classic', 'mascot'])
export type CursorStyle = z.infer<typeof cursorStyleSchema>
export const trustStateSchema = z.enum(['inspection', 'trusted', 'revoked'])
export type TrustState = z.infer<typeof trustStateSchema>
export const projectTypeSchema = z.enum(['single-file', 'multi-file', 'cmake'])
export type ProjectType = z.infer<typeof projectTypeSchema>
export const projectCreationModeSchema = z.enum(['manual', 'problem', 'description', 'import'])
export type ProjectCreationMode = z.infer<typeof projectCreationModeSchema>

export const appErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  userAction: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional()
})
export type AppError = z.infer<typeof appErrorSchema>
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError }
export const success = <T>(data: T): ApiResult<T> => ({ ok: true, data })
export const failure = (error: AppError): ApiResult<never> => ({ ok: false, error })

export const workspaceSchema = z.object({
  id: z.string().uuid(), name: z.string(), rootPath: z.string(),
  trustState: trustStateSchema, createdAt: z.string(), lastOpenedAt: z.string(),
  readOnlyReason: z.string().optional()
})
export type Workspace = z.infer<typeof workspaceSchema>

export const projectSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), name: z.string(),
  type: projectTypeSchema, creationMode: projectCreationModeSchema,
  relativeRoot: z.string(), problemId: z.string().uuid().optional(),
  createdAt: z.string(), updatedAt: z.string(), lastOpenedAt: z.string()
})
export type Project = z.infer<typeof projectSchema>

export const proposedFileSchema = z.object({ relativePath: z.string(), content: z.string() })
export const projectDraftSchema = z.object({
  draftId: z.string().uuid(), mode: projectCreationModeSchema,
  workspaceId: z.string().uuid().optional(), name: z.string().min(1).max(80),
  type: projectTypeSchema, relativeRoot: z.string(),
  proposedFiles: z.array(proposedFileSchema),
  problem: z.object({
    statement: z.string(), constraints: z.array(z.string()),
    samples: z.array(z.object({ input: z.string(), output: z.string() }))
  }).optional(),
  sourceDirectory: z.string().optional(), warnings: z.array(z.string())
})
export type ProjectDraft = z.infer<typeof projectDraftSchema>
export const projectDraftInputSchema = z.object({
  mode: projectCreationModeSchema.exclude(['import']),
  workspaceId: z.string().uuid(), name: z.string().min(1).max(80),
  type: projectTypeSchema, description: z.string().max(5000).optional(),
  statement: z.string().max(30000).optional(),
  constraints: z.array(z.string()).default([]),
  samples: z.array(z.object({ input: z.string(), output: z.string() })).default([])
})
export type ProjectDraftInput = z.input<typeof projectDraftInputSchema>

export interface FileTreeNode {
  name: string
  relativePath: string
  kind: 'file' | 'directory'
  editable: boolean
  size?: number
  modifiedAt?: string
  children?: FileTreeNode[]
}
export interface FileDocument {
  projectId: string
  relativePath: string
  content: string
  contentHash: string
  modifiedAt: string
  encoding: 'utf8' | 'utf8-bom'
  eol: 'lf' | 'crlf'
  readOnly: boolean
}
export const fileRevisionSchema = z.object({
  projectId: z.string().uuid(), relativePath: z.string(), content: z.string().max(2_097_152),
  expectedHash: z.string(), createSnapshot: z.boolean().default(true)
})
export type FileRevision = z.input<typeof fileRevisionSchema>
export interface SearchResult { relativePath: string; line: number; excerpt: string; start: number; end: number }

export interface SnapshotManifest {
  id: string
  projectId: string
  label: string
  reason: 'manual' | 'before-write' | 'before-delete' | 'before-restore'
  scope: 'project' | 'files'
  entries: Array<{ relativePath: string; contentHash: string; size: number }>
  createdAt: string
}
export interface RestorePreview {
  snapshotId: string
  added: string[]
  overwritten: string[]
  deleted: string[]
  unchanged: string[]
}
export interface WorkspaceChangedEvent {
  workspaceId: string
  projectId?: string
  kind: 'created' | 'changed' | 'deleted' | 'renamed' | 'trust-changed'
  relativePath?: string
  previousRelativePath?: string
  contentHash?: string
  occurredAt: string
}
export interface DomainEvent<T = unknown> {
  eventId: string; type: string; version: 1; occurredAt: string
  actor: 'user' | 'system' | 'agent' | 'tool'; projectId?: string; payload: T
}
export type AgentApprovalMode = 'always' | 'on-risk' | 'full'
export interface AppSettings {
  theme: ThemePreference
  lastProjectId?: string
  activeToolchainId?: string
  sidebarWidth: number
  inspectorWidth: number
  bottomPanelHeight: number
  /**
   * 鼠标指针样式：
   * - system: 系统默认
   * - classic: 经典代码箭头
   * - mascot: 猫猫指针（默认）
   */
  cursorStyle: CursorStyle
  onboardingCompleted: boolean
  onboardingStatus: 'pending' | 'completed' | 'skipped'
  onboardingReminderDismissed: boolean
  productTourStatus: 'pending' | 'in-progress' | 'completed' | 'dismissed'
  productTourStep: number
  productTourWelcomeSeen: boolean
  /** Agent 操作审批：always=每次询问，on-risk=仅风险操作，full=完全自动 */
  agentApprovalMode: AgentApprovalMode
  pet: PetSettings
}
export interface AppBootstrap {
  version: string; platform: string; recoveryMode: boolean; settings: AppSettings
  recentProjects: Project[]; workspaces: Workspace[]; recentEvents: DomainEvent[]
}
export interface MockDashboard {
  environment: Array<{ id: string; label: string; status: 'ready' | 'missing' | 'checking'; detail: string }>
}

export interface CppPetApi {
  app: {
    getBootstrap(): Promise<ApiResult<AppBootstrap>>
    getVersion(): Promise<ApiResult<string>>
    copyText(input: { text: string }): Promise<ApiResult<void>>
    onNavigate(listener: (event: AppNavigationEvent) => void): () => void
  }
  settings: { get(): Promise<ApiResult<AppSettings>>; update(input: Partial<AppSettings>): Promise<ApiResult<AppSettings>> }
  workspace: {
    selectRoot(): Promise<ApiResult<Workspace | null>>
    list(): Promise<ApiResult<Workspace[]>>
    open(input: { workspaceId: string }): Promise<ApiResult<Workspace>>
    setTrust(input: { workspaceId: string; trusted: boolean }): Promise<ApiResult<Workspace>>
    remove(input: { workspaceId: string }): Promise<ApiResult<void>>
    onChanged(listener: (event: WorkspaceChangedEvent) => void): () => void
  }
  project: {
    preview(input: ProjectDraftInput): Promise<ApiResult<ProjectDraft>>
    create(input: { draftId: string }): Promise<ApiResult<Project>>
    previewImport(): Promise<ApiResult<ProjectDraft | null>>
    import(input: { draftId: string }): Promise<ApiResult<Project>>
    list(input?: { workspaceId?: string }): Promise<ApiResult<Project[]>>
    open(input: { projectId: string }): Promise<ApiResult<Project>>
    rename(input: { projectId: string; name: string }): Promise<ApiResult<Project>>
    remove(input: { projectId: string; deleteFiles: boolean }): Promise<ApiResult<{ removed: boolean }>>
  }
  files: {
    listTree(input: { projectId: string }): Promise<ApiResult<FileTreeNode[]>>
    read(input: { projectId: string; relativePath: string }): Promise<ApiResult<FileDocument>>
    write(input: FileRevision): Promise<ApiResult<FileDocument>>
    create(input: { projectId: string; relativePath: string; kind: 'file' | 'directory' }): Promise<ApiResult<FileTreeNode>>
    copy(input: { projectId: string; relativePath: string; destination: string }): Promise<ApiResult<void>>
    move(input: { projectId: string; relativePath: string; destination: string }): Promise<ApiResult<void>>
    rename(input: { projectId: string; relativePath: string; nextName: string }): Promise<ApiResult<void>>
    remove(input: { projectId: string; relativePath: string }): Promise<ApiResult<void>>
    search(input: { projectId: string; query: string }): Promise<ApiResult<SearchResult[]>>
  }
  snapshots: {
    create(input: { projectId: string; label: string }): Promise<ApiResult<SnapshotManifest>>
    list(input: { projectId: string }): Promise<ApiResult<SnapshotManifest[]>>
    previewRestore(input: { snapshotId: string }): Promise<ApiResult<RestorePreview>>
    restore(input: { snapshotId: string }): Promise<ApiResult<void>>
    remove(input: { snapshotId: string }): Promise<ApiResult<void>>
  }
  toolchains: {
    detect(): Promise<ApiResult<ToolchainDetectionResult>>
    probe(input: { candidateId: string }): Promise<ApiResult<ToolchainProbeResult>>
    list(): Promise<ApiResult<ToolchainBindingState>>
    bind(input: { candidateId: string }): Promise<ApiResult<ToolchainProfile>>
    unbind(input: { profileId: string }): Promise<ApiResult<void>>
    health(input: { profileId: string }): Promise<ApiResult<ToolchainHealthResult>>
  }
  compiler: {
    build(input: BuildRequest): Promise<ApiResult<BuildResult>>
  }
  cmake: {
    build(input: CmakeBuildRequest): Promise<ApiResult<CmakeBuildResult>>
  }
  ctest: {
    run(input: CtestRunRequest): Promise<ApiResult<CtestRunResult>>
  }
  analysis: {
    clangTidy(input: StaticAnalysisRequest): Promise<ApiResult<StaticAnalysisResult>>
  }
  vscode: {
    open(input: VscodeOpenRequest): Promise<ApiResult<VscodeOpenResult>>
  }
  environment: {
    openDownload(input: EnvironmentOpenDownloadRequest): Promise<ApiResult<void>>
    installerStatus(): Promise<ApiResult<EnvironmentInstallerStatus>>
    install(input: EnvironmentInstallRequest): Promise<ApiResult<EnvironmentInstallResult>>
    installTasks(): Promise<ApiResult<EnvironmentInstallTask[]>>
    onInstallChanged(listener: (task: EnvironmentInstallTask) => void): () => void
  }
  language: {
    status(input: LanguageStatusRequest): Promise<ApiResult<LanguageStatus>>
    sync(input: LanguageDocumentSync): Promise<ApiResult<void>>
    completion(input: LanguagePositionRequest): Promise<ApiResult<LanguageCompletion[]>>
    hover(input: LanguagePositionRequest): Promise<ApiResult<LanguageHover | null>>
    definition(input: LanguagePositionRequest): Promise<ApiResult<LanguageDefinition | null>>
    onDiagnostics(listener: (event: LanguageDiagnosticsEvent) => void): () => void
  }
  debug: {
    start(input: DebugStartRequest): Promise<ApiResult<DebugSessionState>>
    command(input: DebugCommandRequest): Promise<ApiResult<DebugSessionState>>
  }
  program: {
    run(input: ProgramRunRequest): Promise<ApiResult<ProgramRunResult>>
    stop(input: ProgramStopRequest): Promise<ApiResult<ProgramStopResult>>
  }
  diagnostics: {
    listActive(input: { projectId: string }): Promise<ApiResult<DiagnosticInboxChangedEvent>>
    acknowledge(input: { projectId: string }): Promise<ApiResult<DiagnosticInboxChangedEvent>>
    onChanged(listener: (event: DiagnosticInboxChangedEvent) => void): () => void
  }
  conversations: {
    list(input: { projectId: string }): Promise<ApiResult<AgentConversation[]>>
    create(input: ConversationCreateInput): Promise<ApiResult<AgentConversation>>
    archive(input: ConversationArchiveInput): Promise<ApiResult<AgentConversation>>
    messages(input: ConversationMessagesInput): Promise<ApiResult<AgentMessage[]>>
    submitAgent(input: ConversationSendInput): Promise<ApiResult<ConversationAgentSubmitResult>>
    onChanged(listener: (event: ConversationChangedEvent) => void): () => void
  }
  agent: {
    start(input: AgentStartRequest): Promise<ApiResult<AgentRun>>
    continue(input: AgentContinueRequest): Promise<ApiResult<AgentRun>>
    get(input: { runId: string }): Promise<ApiResult<AgentRunDetail>>
    list(input?: { status?: AgentRunStatus; projectId?: string; limit?: number }): Promise<ApiResult<AgentRun[]>>
    cancel(input: { runId: string }): Promise<ApiResult<AgentRun>>
    onChanged(listener: (run: AgentRun) => void): () => void
  }
  approvals: {
    decide(input: ApprovalDecision): Promise<ApiResult<AgentRun>>
  }
  learning: {
    catalog(): Promise<ApiResult<KnowledgeNode[]>>
    knowledge(input?: { userId?: string }): Promise<ApiResult<LearnerKnowledge[]>>
    updateKnowledge(input: { userId?: string; conceptId: string; status: KnowledgeStatus; unlockPath?: boolean }): Promise<ApiResult<LearnerKnowledge | LearnerKnowledge[]>>
    background(input?: { userId?: string }): Promise<ApiResult<BackgroundProfile | null>>
    saveBackground(input: BackgroundProfileInput & { userId?: string }): Promise<ApiResult<BackgroundProfile>>
    errors(input?: { userId?: string; status?: ErrorBookEntry['status'] }): Promise<ApiResult<ErrorBookEntry[]>>
    reviews(input?: { userId?: string; dueOnly?: boolean }): Promise<ApiResult<ReviewItem[]>>
    summary(input?: { userId?: string }): Promise<ApiResult<LearnerSummary>>
    practiceCatalog(): Promise<ApiResult<PracticeCatalog>>
    submitPractice(input: PracticeSubmissionRequest): Promise<ApiResult<PracticeSubmissionResult>>
    completePracticeProject(input: PracticeProjectCompleteRequest): Promise<ApiResult<PracticeProjectCompleteResult>>
    importOjScreenshot(input: PracticeOjImportInput): Promise<ApiResult<PracticeOjImportResult>>
  }
  model: {
    list(): Promise<ApiResult<ModelProfile[]>>
    save(input: ModelProfileInput): Promise<ApiResult<ModelProfile>>
    remove(input: { profileId: string }): Promise<ApiResult<void>>
    clearKey(input: { profileId: string }): Promise<ApiResult<ModelProfile>>
    test(input: { profileId: string }): Promise<ApiResult<{
      ok: boolean
      latencyMs: number
      detail: string
      protocol: Exclude<ModelProfile['protocol'], 'auto'>
      capabilities: ModelProfile['capabilities']
    }>>
    testVision(input: { profileId: string }): Promise<ApiResult<{
      supported: boolean
      latencyMs: number
      detail: string
      protocol: Exclude<ModelProfile['protocol'], 'auto'>
    }>>
  }
  screenshot: {
    capture(input: ScreenshotCaptureRequest): Promise<ApiResult<void>>
    getPending(): Promise<ApiResult<ScreenshotPendingCapture | null>>
    submit(input: ScreenshotCaptureSubmission): Promise<ApiResult<AgentRun>>
    cancel(): Promise<ApiResult<void>>
    onSubmitted(listener: (event: ScreenshotSubmittedEvent) => void): () => void
  }
  pet: {
    getState(): Promise<ApiResult<PetWindowState>>
    updateSettings(input: Partial<PetSettings>): Promise<ApiResult<PetWindowState>>
    show(): Promise<ApiResult<PetWindowState>>
    hide(): Promise<ApiResult<PetWindowState>>
    toggle(): Promise<ApiResult<PetWindowState>>
    move(input: { deltaX: number; deltaY: number }): Promise<ApiResult<PetWindowState>>
    drag(input: PetDragWindowRequest): Promise<ApiResult<PetWindowState>>
    dragEnd(): Promise<ApiResult<PetWindowState>>
    undock(): Promise<ApiResult<PetWindowState>>
    setIgnoreMouseEvents(input: { ignoreMouseEvents: boolean }): Promise<ApiResult<PetWindowState>>
    openMain(): Promise<ApiResult<void>>
    showContextMenu(): Promise<ApiResult<void>>
    selectCustomAsset(input: PetCustomAssetCreateInput): Promise<ApiResult<PetWindowState>>
    resetCustomAsset(): Promise<ApiResult<PetWindowState>>
    renameCustomAsset(input: PetCustomAssetRename): Promise<ApiResult<PetWindowState>>
    deleteCustomAsset(input: PetCustomAssetMutation): Promise<ApiResult<PetWindowState>>
    activateCustomAsset(input: PetCustomAssetMutation): Promise<ApiResult<PetWindowState>>
    hideForOneHour(): Promise<ApiResult<PetWindowState>>
    cancelHidden(): Promise<ApiResult<PetWindowState>>
    toggleFocusMode(input?: { enabled?: boolean }): Promise<ApiResult<PetWindowState>>
    toggleLaunchAtLogin(input?: { enabled?: boolean }): Promise<ApiResult<PetWindowState>>
    chat(input: PetChatRequest): Promise<ApiResult<PetChatResult>>
    onQuickChat(listener: () => void): () => void
    onStateChanged(listener: (state: PetWindowState) => void): () => void
    onChanged(listener: (event: PetEvent) => void): () => void
    onEvent(listener: (event: PetEvent) => void): () => void
  }
  mocks: { getDashboard(): Promise<ApiResult<MockDashboard>> }
}
