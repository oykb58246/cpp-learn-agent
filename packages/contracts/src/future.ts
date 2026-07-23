import { z } from 'zod'

export const diagnosticSchema = z.object({
  source: z.enum(['compiler', 'linker', 'runtime', 'clangd', 'clang-tidy', 'debugger', 'judge']),
  severity: z.enum(['info', 'warning', 'error']), code: z.string().optional(), file: z.string().optional(),
  line: z.number().int().positive().optional(), column: z.number().int().positive().optional(),
  rawMessage: z.string(), normalizedMessage: z.string(), relatedConceptIds: z.array(z.string())
})
export type Diagnostic = z.infer<typeof diagnosticSchema>

export const processResultSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  outputTruncated: z.boolean()
})
export type ProcessResult = z.infer<typeof processResultSchema>

export const toolchainFamilySchema = z.enum(['gcc', 'clang', 'msvc'])
export type ToolchainFamily = z.infer<typeof toolchainFamilySchema>

export const toolchainCapabilitiesSchema = z.object({
  compile: z.boolean(),
  debug: z.boolean(),
  compileDatabase: z.boolean()
})
export type ToolchainCapabilities = z.infer<typeof toolchainCapabilitiesSchema>

export const toolchainProfileSchema = z.object({
  id: z.string().uuid(), family: toolchainFamilySchema, version: z.string(), targetArch: z.string(),
  compilerPath: z.string(), debuggerPath: z.string().optional(), environmentScript: z.string().optional(),
  languageServerPath: z.string().optional(), cmakeGenerator: z.string().optional(), compileCommandsPath: z.string().optional(),
  capabilities: toolchainCapabilitiesSchema, verifiedAt: z.string()
})
export type ToolchainProfile = z.infer<typeof toolchainProfileSchema>

export const toolchainCandidateSchema = z.object({
  id: z.string(),
  family: toolchainFamilySchema,
  compilerPath: z.string(),
  version: z.string(),
  targetArch: z.string(),
  source: z.enum(['path', 'common-location', 'visual-studio']),
  debuggerPath: z.string().optional(),
  environmentScript: z.string().optional(),
  languageServerPath: z.string().optional(),
  cmakeGenerator: z.string().optional(),
  capabilities: toolchainCapabilitiesSchema
})
export type ToolchainCandidate = z.infer<typeof toolchainCandidateSchema>

export const developmentToolSchema = z.object({
  kind: z.enum(['vscode', 'cmake', 'ctest', 'ninja', 'make', 'gdb', 'lldb', 'clangd', 'clang-tidy']),
  path: z.string(),
  version: z.string().optional()
})
export type DevelopmentTool = z.infer<typeof developmentToolSchema>

export const toolchainDetectionResultSchema = z.object({
  candidates: z.array(toolchainCandidateSchema),
  tools: z.array(developmentToolSchema),
  detectedAt: z.string()
})
export type ToolchainDetectionResult = z.infer<typeof toolchainDetectionResultSchema>

export const toolchainProbeResultSchema = z.object({
  candidate: toolchainCandidateSchema,
  success: z.boolean(),
  compile: processResultSchema,
  run: processResultSchema.optional(),
  profile: toolchainProfileSchema.optional(),
  failureReason: z.string().optional()
})
export type ToolchainProbeResult = z.infer<typeof toolchainProbeResultSchema>

export const toolchainBindingStateSchema = z.object({
  profiles: z.array(toolchainProfileSchema),
  activeProfileId: z.string().uuid().optional()
})
export type ToolchainBindingState = z.infer<typeof toolchainBindingStateSchema>

export const toolchainHealthResultSchema = z.object({
  profileId: z.string().uuid(),
  healthy: z.boolean(),
  checkedAt: z.string(),
  versionResult: processResultSchema.optional(),
  reason: z.string().optional()
})
export type ToolchainHealthResult = z.infer<typeof toolchainHealthResultSchema>

export const cppStandardSchema = z.enum(['c++17', 'c++20', 'c++23'])
export type CppStandard = z.infer<typeof cppStandardSchema>

export const buildRequestSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024),
  standard: cppStandardSchema.default('c++17')
})
export type BuildRequest = z.input<typeof buildRequestSchema>

export const buildResultSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  projectId: z.string().uuid(),
  relativePath: z.string(),
  profileId: z.string().uuid(),
  success: z.boolean(),
  artifactName: z.string(),
  process: processResultSchema,
  diagnostics: z.array(diagnosticSchema),
  builtAt: z.string()
})
export type BuildResult = z.infer<typeof buildResultSchema>

export const programRunRequestSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  input: z.string().max(65_536).default(''),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000)
})
export type ProgramRunRequest = z.input<typeof programRunRequestSchema>

export const programRunResultSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  success: z.boolean(),
  process: processResultSchema,
  diagnostics: z.array(diagnosticSchema)
})
export type ProgramRunResult = z.infer<typeof programRunResultSchema>

export const programStopRequestSchema = z.object({ runId: z.string().uuid() })
export type ProgramStopRequest = z.infer<typeof programStopRequestSchema>
export const programStopResultSchema = z.object({ runId: z.string().uuid(), stopped: z.boolean() })
export type ProgramStopResult = z.infer<typeof programStopResultSchema>

export const cmakeConfigurationSchema = z.enum(['Debug', 'Release'])
export type CmakeConfiguration = z.infer<typeof cmakeConfigurationSchema>

export const cmakeBuildRequestSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  standard: cppStandardSchema.default('c++17'),
  configuration: cmakeConfigurationSchema.default('Debug')
})
export type CmakeBuildRequest = z.input<typeof cmakeBuildRequestSchema>

export const cmakeBuildResultSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  projectId: z.string().uuid(),
  profileId: z.string().uuid(),
  configuration: cmakeConfigurationSchema,
  success: z.boolean(),
  configure: processResultSchema,
  build: processResultSchema.optional(),
  diagnostics: z.array(diagnosticSchema),
  compileCommandsGenerated: z.boolean(),
  builtAt: z.string()
})
export type CmakeBuildResult = z.infer<typeof cmakeBuildResultSchema>

export const ctestRunRequestSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000)
})
export type CtestRunRequest = z.input<typeof ctestRunRequestSchema>

export const ctestRunResultSchema = z.object({
  runId: z.string().uuid(),
  buildId: z.string().uuid(),
  success: z.boolean(),
  process: processResultSchema,
  diagnostics: z.array(diagnosticSchema),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
})
export type CtestRunResult = z.infer<typeof ctestRunResultSchema>

export const staticAnalysisRequestSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024),
  standard: cppStandardSchema.default('c++17')
})
export type StaticAnalysisRequest = z.input<typeof staticAnalysisRequestSchema>

export const staticAnalysisResultSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  relativePath: z.string(),
  success: z.boolean(),
  process: processResultSchema,
  diagnostics: z.array(diagnosticSchema),
  analyzedAt: z.string()
})
export type StaticAnalysisResult = z.infer<typeof staticAnalysisResultSchema>

export const vscodeOpenRequestSchema = z.object({
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional()
})
export type VscodeOpenRequest = z.infer<typeof vscodeOpenRequestSchema>

export const vscodeOpenResultSchema = z.object({
  success: z.boolean(),
  process: processResultSchema
})
export type VscodeOpenResult = z.infer<typeof vscodeOpenResultSchema>

export const environmentDownloadTargetSchema = z.enum(['msys2', 'llvm', 'cmake', 'vscode', 'visual-studio'])
export type EnvironmentDownloadTarget = z.infer<typeof environmentDownloadTargetSchema>
export const environmentOpenDownloadRequestSchema = z.object({ target: environmentDownloadTargetSchema })
export type EnvironmentOpenDownloadRequest = z.infer<typeof environmentOpenDownloadRequestSchema>
export const environmentInstallTargetSchema = z.enum(['msys2', 'llvm', 'cmake', 'vscode'])
export type EnvironmentInstallTarget = z.infer<typeof environmentInstallTargetSchema>
export const environmentInstallRequestSchema = z.object({ target: environmentInstallTargetSchema })
export type EnvironmentInstallRequest = z.infer<typeof environmentInstallRequestSchema>
export const environmentInstallerStatusSchema = z.object({
  available: z.boolean(),
  manager: z.literal('winget'),
  version: z.string().optional(),
  reason: z.string().optional()
})
export type EnvironmentInstallerStatus = z.infer<typeof environmentInstallerStatusSchema>
export const environmentInstallTaskSchema = z.object({
  taskId: z.string().uuid(),
  target: environmentInstallTargetSchema,
  packageId: z.string(),
  status: z.enum(['running', 'succeeded', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  verificationFailure: z.string().optional()
})
export type EnvironmentInstallTask = z.infer<typeof environmentInstallTaskSchema>
export const environmentInstallResultSchema = z.object({
  launched: z.boolean(),
  target: environmentInstallTargetSchema,
  packageId: z.string(),
  task: environmentInstallTaskSchema.optional()
})
export type EnvironmentInstallResult = z.infer<typeof environmentInstallResultSchema>

export const languageStatusRequestSchema = z.object({ projectId: z.string().uuid() })
export type LanguageStatusRequest = z.infer<typeof languageStatusRequestSchema>
export const languageStatusSchema = z.object({
  available: z.boolean(),
  serverPath: z.string().optional(),
  reason: z.string().optional()
})
export type LanguageStatus = z.infer<typeof languageStatusSchema>

export const languageDocumentSyncSchema = z.object({
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024),
  content: z.string().max(2_097_152),
  version: z.number().int().positive()
})
export type LanguageDocumentSync = z.infer<typeof languageDocumentSyncSchema>

export const languagePositionRequestSchema = z.object({
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024),
  line: z.number().int().positive(),
  column: z.number().int().positive()
})
export type LanguagePositionRequest = z.infer<typeof languagePositionRequestSchema>

export const languageCompletionSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
  documentation: z.string().optional(),
  insertText: z.string().optional(),
  kind: z.number().int().optional()
})
export type LanguageCompletion = z.infer<typeof languageCompletionSchema>

export const languageHoverSchema = z.object({ contents: z.string() })
export type LanguageHover = z.infer<typeof languageHoverSchema>

export const languageDefinitionSchema = z.object({
  relativePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive()
})
export type LanguageDefinition = z.infer<typeof languageDefinitionSchema>

export const languageDiagnosticsEventSchema = z.object({
  projectId: z.string().uuid(),
  relativePath: z.string(),
  diagnostics: z.array(diagnosticSchema)
})
export type LanguageDiagnosticsEvent = z.infer<typeof languageDiagnosticsEventSchema>

export const debugBreakpointSchema = z.object({
  relativePath: z.string().min(1).max(1_024),
  line: z.number().int().positive()
})
export type DebugBreakpoint = z.infer<typeof debugBreakpointSchema>

export const debugStartRequestSchema = z.object({
  projectId: z.string().uuid(),
  relativePath: z.string().min(1).max(1_024),
  standard: cppStandardSchema.default('c++17'),
  breakpoints: z.array(debugBreakpointSchema).max(100)
})
export type DebugStartRequest = z.input<typeof debugStartRequestSchema>

export const debugCommandSchema = z.enum(['continue', 'next', 'step-in', 'step-out', 'stop'])
export type DebugCommand = z.infer<typeof debugCommandSchema>
export const debugCommandRequestSchema = z.object({
  sessionId: z.string().uuid(),
  command: debugCommandSchema
})
export type DebugCommandRequest = z.infer<typeof debugCommandRequestSchema>

export const debugFrameSchema = z.object({
  level: z.number().int().nonnegative(),
  functionName: z.string(),
  relativePath: z.string().optional(),
  line: z.number().int().positive().optional()
})
export type DebugFrame = z.infer<typeof debugFrameSchema>

export const debugVariableSchema = z.object({
  name: z.string(),
  value: z.string(),
  type: z.string().optional()
})
export type DebugVariable = z.infer<typeof debugVariableSchema>

export const debugSessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.enum(['starting', 'running', 'stopped', 'exited', 'error']),
  reason: z.string().optional(),
  location: languageDefinitionSchema.optional(),
  frames: z.array(debugFrameSchema),
  variables: z.array(debugVariableSchema),
  output: z.string(),
  diagnostics: z.array(diagnosticSchema)
})
export type DebugSessionState = z.infer<typeof debugSessionStateSchema>

export const learnerProfileSchema = z.object({
  userId: z.string(), allowedConceptIds: z.array(z.string()), learningConceptIds: z.array(z.string()),
  reviewConceptIds: z.array(z.string()), preferredHintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)])
})
export type LearnerProfile = z.infer<typeof learnerProfileSchema>

export const agentRequestSchema = z.object({
  requestId: z.string().uuid(), source: z.enum(['main', 'editor', 'pet', 'screenshot', 'system']),
  mode: z.enum(['environment', 'explain', 'diagnose', 'solve', 'project', 'review', 'edit', 'chat']), message: z.string(),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()), activeFile: z.string().optional(),
  selection: z.object({ startLine: z.number(), startColumn: z.number(), endLine: z.number(), endColumn: z.number() }).optional(),
  screenshotRef: z.string().optional()
})
export type AgentRequest = z.infer<typeof agentRequestSchema>

export const planStepSchema = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['reason', 'resource', 'tool', 'approval', 'validate', 'respond']),
  toolName: z.string().optional(), status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'])
})
export type PlanStep = z.infer<typeof planStepSchema>
export const agentPlanSchema = z.object({
  runId: z.string().uuid(), intent: z.string(), steps: z.array(planStepSchema), successCriteria: z.array(z.string()),
  stopConditions: z.array(z.string()), conceptIdsExpected: z.array(z.string())
})
export type AgentPlan = z.infer<typeof agentPlanSchema>

export const petAssetModeSchema = z.enum(['cpppilot-logo', 'salary-cat', 'custom'])
export type PetAssetMode = z.infer<typeof petAssetModeSchema>
export const petCustomAssetMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export type PetCustomAssetMime = z.infer<typeof petCustomAssetMimeSchema>
export const petCustomAssetSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(2_048),
  mime: petCustomAssetMimeSchema,
  updatedAt: z.string().datetime()
}).strict()
export type PetCustomAsset = z.infer<typeof petCustomAssetSchema>
export const petGrowthStageSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
export type PetGrowthStage = z.infer<typeof petGrowthStageSchema>
export const petProgressSchema = z.object({
  stage: petGrowthStageSchema,
  totalStages: z.literal(4).default(4),
  percent: z.number().int().min(0).max(100),
  label: z.string().min(1).max(80)
}).strict()
export type PetProgress = z.infer<typeof petProgressSchema>

const petSettingsObjectSchema = z.object({
  visible: z.boolean().default(true),
  assetMode: petAssetModeSchema.default('cpppilot-logo'),
  scale: z.number().min(0.5).max(2).default(1),
  ignoreMouseEvents: z.boolean().default(false),
  bubbleEnabled: z.boolean().default(true),
  frameEnabled: z.boolean().default(true),
  progressBarEnabled: z.boolean().default(true),
  edgeDockEnabled: z.boolean().default(true),
  docked: z.boolean().default(false),
  focusModeEnabled: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  hiddenUntil: z.string().datetime().optional(),
  customAssets: z.array(petCustomAssetSchema).max(50).default([]),
  activeCustomAssetId: z.string().min(1).max(120).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  undockedX: z.number().optional(),
  undockedY: z.number().optional(),
  undockedScale: z.number().min(0.5).max(2).optional()
}).strip()
export const petSettingsSchema = z.preprocess(normalizePetSettingsInput, petSettingsObjectSchema)
export type PetSettings = z.infer<typeof petSettingsSchema>
// Patch must be truly partial: Zod .default() still fills omitted keys on .partial(),
// which made frame/progress/asset toggles rewrite unrelated pet settings.
const petSettingsPatchObjectSchema = z.object({
  visible: z.boolean().optional(),
  assetMode: petAssetModeSchema.optional(),
  scale: z.number().min(0.5).max(2).optional(),
  ignoreMouseEvents: z.boolean().optional(),
  bubbleEnabled: z.boolean().optional(),
  frameEnabled: z.boolean().optional(),
  progressBarEnabled: z.boolean().optional(),
  edgeDockEnabled: z.boolean().optional(),
  docked: z.boolean().optional(),
  focusModeEnabled: z.boolean().optional(),
  launchAtLogin: z.boolean().optional(),
  hiddenUntil: z.string().datetime().optional(),
  customAssets: z.array(petCustomAssetSchema).max(50).optional(),
  activeCustomAssetId: z.string().min(1).max(120).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  undockedX: z.number().optional(),
  undockedY: z.number().optional(),
  undockedScale: z.number().min(0.5).max(2).optional()
}).strip()
export const petSettingsPatchSchema = z.preprocess(normalizePetSettingsInput, petSettingsPatchObjectSchema)
export type PetSettingsPatch = z.infer<typeof petSettingsPatchSchema>

function normalizePetSettingsInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const raw = { ...(input as Record<string, unknown>) }

  // 仅在显式传入 assetMode 时规范化，避免 partial patch 覆盖成 undefined/默认值
  if ('assetMode' in raw) {
    raw.assetMode = raw.assetMode === 'cpppilot-mascot' || raw.assetMode === 'cpppilot-cursor'
      ? 'cpppilot-logo'
      : raw.assetMode
  }

  const legacyPath = typeof raw.customAssetPath === 'string' ? raw.customAssetPath : ''
  const legacyName = typeof raw.customAssetName === 'string' && raw.customAssetName.trim()
    ? raw.customAssetName.trim()
    : legacyPath.split(/[\\/]/).pop() || '自定义素材'
  const legacyMime = petCustomAssetMimeSchema.safeParse(raw.customAssetMime).success
    ? raw.customAssetMime as PetCustomAssetMime
    : undefined
  const legacyUpdatedAt = typeof raw.customAssetUpdatedAt === 'string'
    ? raw.customAssetUpdatedAt
    : new Date(0).toISOString()

  // 仅在已有 customAssets 字段或需要迁入 legacy 路径时处理，避免空数组冲掉已有素材
  if (Array.isArray(raw.customAssets) || (legacyPath && legacyMime)) {
    const existingAssets = Array.isArray(raw.customAssets) ? raw.customAssets : []
    raw.customAssets = existingAssets.length || !legacyPath || !legacyMime
      ? existingAssets
      : [{
          id: `legacy-${legacyPath.replace(/[^a-zA-Z0-9]+/g, '-').slice(-72) || 'asset'}`,
          name: legacyName,
          path: legacyPath,
          mime: legacyMime,
          updatedAt: legacyUpdatedAt
        }]
    const firstCustomAsset = (raw.customAssets as unknown[])[0]
    if (
      !('activeCustomAssetId' in raw)
      && raw.assetMode === 'custom'
      && firstCustomAsset
      && typeof firstCustomAsset === 'object'
      && firstCustomAsset
      && typeof (firstCustomAsset as { id?: unknown }).id === 'string'
    ) {
      raw.activeCustomAssetId = (firstCustomAsset as { id: string }).id
    }
  }

  delete raw.customAssetPath
  delete raw.customAssetName
  delete raw.customAssetMime
  delete raw.customAssetUpdatedAt
  return raw
}

const petWindowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
}).strict()

export const petDragWindowRequestSchema = z.object({
  initialBounds: petWindowBoundsSchema,
  pointerStartScreenX: z.number(),
  pointerStartScreenY: z.number(),
  pointerCurrentScreenX: z.number(),
  pointerCurrentScreenY: z.number()
}).strict()
export type PetDragWindowRequest = z.infer<typeof petDragWindowRequestSchema>

export const petCustomAssetMutationSchema = z.object({
  assetId: z.string().min(1).max(120)
}).strict()
export type PetCustomAssetMutation = z.infer<typeof petCustomAssetMutationSchema>
export const petCustomAssetCreateInputSchema = z.object({
  name: z.string().min(1).max(120).refine(value => value.trim().length > 0, '素材名称不能为空。')
}).strict()
export type PetCustomAssetCreateInput = z.infer<typeof petCustomAssetCreateInputSchema>
export const petCustomAssetRenameSchema = petCustomAssetMutationSchema.extend({
  name: z.string().min(1).max(120).refine(value => value.trim().length > 0, '素材名称不能为空。')
}).strict()
export type PetCustomAssetRename = z.infer<typeof petCustomAssetRenameSchema>

export const petWindowStateSchema = z.object({
  settings: petSettingsSchema,
  windowVisible: z.boolean(),
  ignoreMouseEvents: z.boolean(),
  growthStage: petGrowthStageSchema.default(1),
  progress: petProgressSchema,
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  customAssetUrl: z.string().max(2_048).optional()
}).strict()
export type PetWindowState = z.infer<typeof petWindowStateSchema>

export const petChatRequestSchema = z.object({
  message: z.string().min(1).max(20_000).refine(value => value.trim().length > 0, '消息不能为空。')
}).strict()
export type PetChatRequest = z.infer<typeof petChatRequestSchema>
export const petChatResultSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  conversationId: z.string().uuid().optional(),
  assistantMessageId: z.string().uuid().optional()
}).strict()
export type PetChatResult = z.infer<typeof petChatResultSchema>

export const screenshotCaptureRequestSchema = z.object({
  message: z.string().min(1).max(20_000).refine(value => value.trim().length > 0, '截图问题不能为空。'),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  activeFile: z.string().max(1_024).optional(),
  conversationId: z.string().uuid().optional()
}).strict()
export type ScreenshotCaptureRequest = z.infer<typeof screenshotCaptureRequestSchema>

export const screenshotPendingCaptureSchema = z.object({
  previewDataUrl: z.string().startsWith('data:image/').max(5_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: z.string()
}).strict()
export type ScreenshotPendingCapture = z.infer<typeof screenshotPendingCaptureSchema>

export const screenshotCaptureSubmissionSchema = z.object({
  message: z.string().min(1).max(20_000).refine(value => value.trim().length > 0, '截图问题不能为空。'),
  previewDataUrl: z.string().startsWith('data:image/').max(5_000_000),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  activeFile: z.string().max(1_024).optional(),
  conversationId: z.string().uuid().optional()
}).strict()
export type ScreenshotCaptureSubmission = z.infer<typeof screenshotCaptureSubmissionSchema>

export const screenshotSubmittedEventSchema = z.object({
  runId: z.string().uuid(),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  conversationId: z.string().uuid().optional()
}).strict()
export type ScreenshotSubmittedEvent = z.infer<typeof screenshotSubmittedEventSchema>

export const appNavigationEventSchema = z.object({
  path: z.string().min(1).max(200),
  query: z.record(z.string(), z.string()).optional()
}).strict()
export type AppNavigationEvent = z.infer<typeof appNavigationEventSchema>

export const petEventSchema = z.object({
  eventId: z.string().uuid(), state: z.enum(['idle', 'listen', 'thinking', 'tool-running', 'approval', 'success', 'warning', 'level-up']),
  message: z.string().optional(), runId: z.string().uuid().optional(), durationMs: z.number().nonnegative().optional()
})
export type PetEvent = z.infer<typeof petEventSchema>

export const practiceJudgeCaseVisibilitySchema = z.enum(['sample', 'hidden'])
export type PracticeJudgeCaseVisibility = z.infer<typeof practiceJudgeCaseVisibilitySchema>
export const practiceJudgeCaseSchema = z.object({
  id: z.string().min(1).max(120),
  input: z.string().max(20_000),
  expectedOutput: z.string().max(20_000),
  score: z.literal(20),
  visibility: practiceJudgeCaseVisibilitySchema,
  reason: z.string().min(1).max(2_000).optional()
}).strict()
export type PracticeJudgeCase = z.infer<typeof practiceJudgeCaseSchema>
export const practiceExerciseSourceSchema = z.enum(['built-in', 'user'])
export type PracticeExerciseSource = z.infer<typeof practiceExerciseSourceSchema>
export const practiceSampleSchema = z.object({
  input: z.string().max(20_000),
  output: z.string().max(20_000)
}).strict()
export type PracticeSample = z.infer<typeof practiceSampleSchema>
const practiceExerciseObjectSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  knowledgePoint: z.string().min(1).max(100),
  conceptIds: z.array(z.string().min(1).max(100)).min(1).max(20),
  difficulty: z.number().int().min(1).max(5),
  statement: z.string().min(1).max(100_000),
  constraints: z.array(z.string().min(1).max(2_000)).max(30),
  samples: z.array(practiceSampleSchema).min(1).max(20),
  judgeCases: z.array(practiceJudgeCaseSchema).length(5),
  starterCode: z.string().max(100_000).optional(),
  source: practiceExerciseSourceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

function normalizePracticeExerciseInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const raw = input as Record<string, unknown>
  if (Array.isArray(raw.judgeCases) && raw.judgeCases.length === 5) return raw
  const samples = Array.isArray(raw.samples)
    ? raw.samples.filter(isPracticeSampleLike).slice(0, 5)
    : []
  if (!samples.length) return raw
  return { ...raw, judgeCases: fallbackPracticeJudgeCases(samples) }
}

function fallbackPracticeJudgeCases(samples: PracticeSample[]): Array<z.infer<typeof practiceJudgeCaseSchema>> {
  const judgeCases: Array<z.infer<typeof practiceJudgeCaseSchema>> = []
  const sourceSamples = samples.length ? samples : [{ input: '', output: '' } as PracticeSample]
  for (const [index, sample] of sourceSamples.slice(0, 5).entries()) {
    judgeCases.push({
      id: 'legacy-case-' + (index + 1),
      input: sample.input,
      expectedOutput: sample.output,
      score: 20 as const,
      visibility: index === 0 ? 'sample' as const : 'hidden' as const
    })
  }
  while (judgeCases.length < 5) {
    const sample = sourceSamples[judgeCases.length % sourceSamples.length] ?? sourceSamples[0]!
    judgeCases.push({
      id: 'legacy-case-' + (judgeCases.length + 1),
      input: sample.input,
      expectedOutput: sample.output,
      score: 20 as const,
      visibility: 'hidden' as const
    })
  }
  return judgeCases
}

function isPracticeSampleLike(value: unknown): value is PracticeSample {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { input?: unknown }).input === 'string'
    && typeof (value as { output?: unknown }).output === 'string'
}

export const practiceExerciseSchema = z.preprocess(normalizePracticeExerciseInput, practiceExerciseObjectSchema)
export type PracticeExercise = z.infer<typeof practiceExerciseSchema>

export const practiceSubmissionRequestSchema = z.object({
  exerciseId: z.string().min(1).max(120),
  code: z.string().min(1).max(100_000),
  standard: cppStandardSchema.default('c++17'),
  userId: z.string().min(1).max(100).default('local-user')
}).strict()
export type PracticeSubmissionRequest = z.input<typeof practiceSubmissionRequestSchema>

export const practiceJudgeCaseResultSchema = z.object({
  caseId: z.string().min(1).max(120),
  visibility: practiceJudgeCaseVisibilitySchema,
  input: z.string().max(20_000),
  expectedOutput: z.string().max(20_000),
  actualOutput: z.string().max(20_000),
  stderr: z.string().max(20_000),
  passed: z.boolean(),
  score: z.number().int().min(0).max(20),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  errorMessage: z.string().max(2_000).optional()
}).strict()
export type PracticeJudgeCaseResult = z.infer<typeof practiceJudgeCaseResultSchema>

export const practiceSubmissionStatusSchema = z.enum(['accepted', 'wrong-answer', 'compile-error', 'runtime-error'])
export type PracticeSubmissionStatus = z.infer<typeof practiceSubmissionStatusSchema>
export const practiceSubmissionResultSchema = z.object({
  submissionId: z.string().uuid(),
  exerciseId: z.string().min(1).max(120),
  userId: z.string().min(1).max(100),
  status: practiceSubmissionStatusSchema,
  score: z.number().int().min(0).max(100),
  totalScore: z.literal(100),
  passed: z.boolean(),
  submittedAt: z.string().datetime(),
  compile: z.object({
    success: z.boolean(),
    diagnostics: z.array(diagnosticSchema),
    process: processResultSchema
  }).strict(),
  cases: z.array(practiceJudgeCaseResultSchema).max(5)
}).strict()
export type PracticeSubmissionResult = z.infer<typeof practiceSubmissionResultSchema>

export const practiceProjectCompleteRequestSchema = z.object({
  taskId: z.string().min(1).max(120),
  userId: z.string().min(1).max(100).default('local-user')
}).strict()
export type PracticeProjectCompleteRequest = z.input<typeof practiceProjectCompleteRequestSchema>
export const practiceProjectCompleteResultSchema = z.object({
  taskId: z.string().min(1).max(120),
  userId: z.string().min(1).max(100),
  xp: z.number().int().nonnegative(),
  completedAt: z.string().datetime()
}).strict()
export type PracticeProjectCompleteResult = z.infer<typeof practiceProjectCompleteResultSchema>

export const practiceProjectTaskSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  knowledgePoint: z.string().min(1).max(100),
  conceptIds: z.array(z.string().min(1).max(100)).min(1).max(20),
  difficulty: z.number().int().min(1).max(5),
  description: z.string().min(1).max(100_000),
  goals: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  suggestedFiles: z.array(z.string().min(1).max(1_024)).min(1).max(30)
}).strict()
export type PracticeProjectTask = z.infer<typeof practiceProjectTaskSchema>

export const practiceCatalogSchema = z.object({
  exercises: z.array(practiceExerciseSchema),
  projects: z.array(practiceProjectTaskSchema)
}).strict()
export type PracticeCatalog = z.infer<typeof practiceCatalogSchema>

export const practiceOjScreenshotInputSchema = z.object({
  previewDataUrl: z.string().startsWith('data:image/').max(5_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict()
export type PracticeOjScreenshotInput = z.infer<typeof practiceOjScreenshotInputSchema>

export const practiceOjImportResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('added'),
    exercise: practiceExerciseSchema
  }).strict(),
  z.object({
    status: z.literal('refused'),
    reason: z.string().min(1).max(2_000)
  }).strict()
])
export type PracticeOjImportResult = z.infer<typeof practiceOjImportResultSchema>
