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
  exitCode: z.number().int().nullable().optional()
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
  mode: z.enum(['environment', 'explain', 'diagnose', 'solve', 'project', 'review', 'chat']), message: z.string(),
  projectId: z.string().uuid().optional(), activeFile: z.string().optional(),
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

export const petEventSchema = z.object({
  eventId: z.string().uuid(), state: z.enum(['idle', 'listen', 'thinking', 'tool-running', 'approval', 'success', 'warning', 'level-up']),
  message: z.string().optional(), runId: z.string().uuid().optional(), durationMs: z.number().nonnegative().optional()
})
export type PetEvent = z.infer<typeof petEventSchema>
