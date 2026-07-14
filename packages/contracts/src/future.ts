import { z } from 'zod'

export const diagnosticSchema = z.object({
  source: z.enum(['compiler', 'linker', 'runtime', 'clangd', 'clang-tidy', 'debugger', 'judge']),
  severity: z.enum(['info', 'warning', 'error']), code: z.string().optional(), file: z.string().optional(),
  line: z.number().int().positive().optional(), column: z.number().int().positive().optional(),
  rawMessage: z.string(), normalizedMessage: z.string(), relatedConceptIds: z.array(z.string())
})
export type Diagnostic = z.infer<typeof diagnosticSchema>

export const toolchainProfileSchema = z.object({
  id: z.string().uuid(), family: z.enum(['gcc', 'clang', 'msvc']), version: z.string(), targetArch: z.string(),
  compilerPath: z.string(), debuggerPath: z.string().optional(), environmentScript: z.string().optional(),
  languageServerPath: z.string().optional(), cmakeGenerator: z.string().optional(), compileCommandsPath: z.string().optional(),
  capabilities: z.object({ compile: z.boolean(), debug: z.boolean(), compileDatabase: z.boolean() }), verifiedAt: z.string()
})
export type ToolchainProfile = z.infer<typeof toolchainProfileSchema>

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
