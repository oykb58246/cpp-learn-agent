import { z } from 'zod'
import { agentIntentSchema } from './agent-protocol'

const boundedRecord = z.record(z.string(), z.unknown())
export const cppPilotOutcomeTypeSchema = z.enum([
  'file_read',
  'file_changed',
  'build_succeeded',
  'tests_succeeded',
  'program_succeeded',
  'analysis_succeeded',
  'debug_succeeded',
  'project_created',
  'environment_configured'
])
export type CppPilotOutcomeType = z.infer<typeof cppPilotOutcomeTypeSchema>

export const cppPilotToolOutcomeSchema = z.object({
  type: cppPilotOutcomeTypeSchema,
  target: z.string().min(1).max(1_024).nullable()
}).strict()
export type CppPilotToolOutcome = z.infer<typeof cppPilotToolOutcomeSchema>

export const cppPilotOutcomeClaimSchema = cppPilotToolOutcomeSchema.extend({
  callId: z.string().min(1).max(200)
}).strict()
export type CppPilotOutcomeClaim = z.infer<typeof cppPilotOutcomeClaimSchema>

const protocolDiagnosticSchema = z.object({
  source: z.string().min(1).max(100),
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string().max(200).optional(),
  file: z.string().max(1_024).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  message: z.string().min(1).max(20_000)
}).strict()

export const cppPilotContextEnvelopeSchema = z.object({
  protocol: z.literal('cpppilot.context.v1'),
  taskId: z.string().uuid(),
  turn: z.number().int().nonnegative().max(100),
  task: z.object({
    prompt: z.string().min(1).max(20_000),
    source: z.enum(['main', 'workspace', 'pet', 'screenshot', 'system']),
    activeFile: z.string().min(1).max(1_024).optional(),
    selection: z.object({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      content: z.string().max(100_000)
    }).strict().nullable().optional(),
    screenshot: z.object({
      id: z.string().uuid(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      bytes: z.number().int().positive().max(6_000_000)
    }).strict().optional()
  }).strict(),
  workspace: z.object({
    project: z.object({
      id: z.string().uuid(),
      workspaceId: z.string().uuid(),
      name: z.string().min(1).max(200),
      type: z.enum(['single-file', 'multi-file', 'cmake'])
    }).strict().optional(),
    activeFile: z.object({
      path: z.string().min(1).max(1_024),
      content: z.string().max(100_000),
      contentHash: z.string().min(1).max(200),
      dirty: z.boolean(),
      truncated: z.boolean(),
      redacted: z.boolean()
    }).strict().optional(),
    relatedFiles: z.array(z.string().min(1).max(1_024)).max(200),
    diagnostics: z.array(protocolDiagnosticSchema).max(200),
    environment: z.object({
      cppStandard: z.enum(['c++17', 'c++20', 'c++23']),
      compiler: z.string().max(500).optional(),
      cmakeAvailable: z.boolean()
    }).strict()
  }).strict(),
  memory: z.object({
    recentConversation: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(100_000)
    }).strict()).max(20),
    learnerProfile: boundedRecord,
    knowledgeState: z.array(boundedRecord).max(200),
    relevantErrors: z.array(boundedRecord).max(50),
    dueReviews: z.array(boundedRecord).max(50),
    recentEvidence: z.array(boundedRecord).max(50)
  }).strict(),
  policy: z.object({
    allowedProjectId: z.string().uuid().optional(),
    allowedWorkspaceId: z.string().uuid().optional(),
    allowedPaths: z.array(z.string().min(1).max(1_024)).max(500),
    allowNewPaths: z.boolean(),
    writesRequireApproval: z.boolean(),
    approvalMode: z.enum(['always', 'on-risk', 'full']).default('on-risk'),
    maxModelTurns: z.number().int().positive().max(50),
    maxToolCalls: z.number().int().positive().max(100),
    remainingTimeMs: z.number().int().nonnegative().max(300_000)
  }).strict()
}).strict()
export type CppPilotContextEnvelope = z.infer<typeof cppPilotContextEnvelopeSchema>

export const cppPilotToolOutputSchema = z.object({
  protocol: z.literal('cpppilot.tool-output.v1'),
  taskId: z.string().uuid(),
  callId: z.string().min(1).max(200),
  tool: z.string().min(1).max(120),
  ok: z.boolean(),
  summary: z.string().max(20_000),
  exitCode: z.number().int().nullable(),
  diagnostics: z.array(protocolDiagnosticSchema).max(200),
  artifacts: z.array(boundedRecord).max(100),
  changedFiles: z.array(z.string().min(1).max(1_024)).max(100),
  outcomes: z.array(cppPilotToolOutcomeSchema).max(100),
  data: boundedRecord.optional(),
  retryable: z.boolean(),
  errorCode: z.string().max(100).optional(),
  durationMs: z.number().int().nonnegative(),
  outputTruncated: z.boolean()
}).strict()
export type CppPilotToolOutput = z.infer<typeof cppPilotToolOutputSchema>

export const cppPilotFinalResponseSchema = z.object({
  protocol: z.literal('cpppilot.final.v1'),
  taskId: z.string().uuid(),
  status: z.enum(['completed', 'needs_input', 'failed']),
  intent: z.object({
    primary: agentIntentSchema,
    secondary: z.array(agentIntentSchema).max(10)
  }).strict(),
  messageMarkdown: z.string().trim().min(1).max(100_000),
  clarificationQuestion: z.string().trim().min(1).max(2_000).nullable(),
  evidenceCallIds: z.array(z.string().min(1).max(200)).max(100),
  claims: z.array(cppPilotOutcomeClaimSchema).max(100),
  suggestedNextActions: z.array(z.string().min(1).max(500)).max(20)
}).strict().superRefine((response, context) => {
  if (response.status === 'needs_input' && !response.clarificationQuestion) {
    context.addIssue({ code: 'custom', path: ['clarificationQuestion'], message: 'needs_input must include clarificationQuestion' })
  }
  if (response.status !== 'needs_input' && response.clarificationQuestion !== null) {
    context.addIssue({ code: 'custom', path: ['clarificationQuestion'], message: 'only needs_input may include clarificationQuestion' })
  }
  const evidenceCallIds = new Set(response.evidenceCallIds)
  for (const [index, claim] of response.claims.entries()) {
    if (!evidenceCallIds.has(claim.callId)) {
      context.addIssue({
        code: 'custom', path: ['claims', index, 'callId'], message: 'claim callId must also appear in evidenceCallIds'
      })
    }
  }
})
export type CppPilotFinalResponse = z.infer<typeof cppPilotFinalResponseSchema>

export const openAiFunctionToolSchema = z.object({
  type: z.literal('function'),
  name: z.string().regex(/^[A-Za-z0-9_-]+$/).max(64),
  description: z.string().min(1).max(2_000),
  strict: z.literal(true),
  parameters: boundedRecord
}).strict()
export type OpenAiFunctionTool = z.infer<typeof openAiFunctionToolSchema>

const openAiFunctionCallSchema = z.object({
  type: z.literal('function_call'),
  id: z.string().min(1).max(200),
  call_id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  arguments: z.string().max(2_097_152),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional()
}).passthrough()

const openAiMessageSchema = z.object({
  type: z.literal('message'),
  id: z.string().min(1).max(200),
  role: z.literal('assistant'),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('output_text'), text: z.string().max(200_000), annotations: z.array(z.unknown()).default([]) }).passthrough(),
    z.object({ type: z.literal('refusal'), refusal: z.string().max(20_000) }).passthrough()
  ])).max(100)
}).passthrough()

const openAiReasoningSchema = z.object({
  type: z.literal('reasoning'),
  id: z.string().min(1).max(200),
  summary: z.array(z.unknown()).default([])
}).passthrough()

export const openAiResponseOutputItemSchema = z.discriminatedUnion('type', [
  openAiFunctionCallSchema,
  openAiMessageSchema,
  openAiReasoningSchema
])
export type OpenAiResponseOutputItem = z.infer<typeof openAiResponseOutputItemSchema>
