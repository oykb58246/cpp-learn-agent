import { z } from 'zod'
import type {
  BuildRequest,
  BuildResult,
  ProgramRunRequest,
  ProgramRunResult,
  ProgramStopRequest,
  ProgramStopResult,
  ToolchainBindingState,
  ToolchainDetectionResult,
  ToolchainHealthResult,
  ToolchainProbeResult,
  ToolchainProfile
} from './future'
export { ipc } from './ipc'
export * from './future'

export const themeSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof themeSchema>
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
export interface AppSettings { theme: ThemePreference; lastProjectId?: string; activeToolchainId?: string; sidebarWidth: number }
export interface AppBootstrap {
  version: string; platform: string; recoveryMode: boolean; settings: AppSettings
  recentProjects: Project[]; workspaces: Workspace[]; recentEvents: DomainEvent[]
}
export interface MockDashboard {
  environment: Array<{ id: string; label: string; status: 'ready' | 'missing' | 'checking'; detail: string }>
  learning: { concept: string; progress: number; reviewCount: number; level: number }
  tasks: Array<{ id: string; title: string; meta: string; status: 'todo' | 'blocked' | 'done' }>
}

export interface CppPetApi {
  app: { getBootstrap(): Promise<ApiResult<AppBootstrap>>; getVersion(): Promise<ApiResult<string>> }
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
    remove(input: { projectId: string; deleteFiles: boolean }): Promise<ApiResult<void>>
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
  program: {
    run(input: ProgramRunRequest): Promise<ApiResult<ProgramRunResult>>
    stop(input: ProgramStopRequest): Promise<ApiResult<ProgramStopResult>>
  }
  mocks: { getDashboard(): Promise<ApiResult<MockDashboard>> }
}
