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
