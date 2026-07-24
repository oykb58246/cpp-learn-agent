import { z } from 'zod'
import { diagnosticSchema } from './future'

const timestampSchema = z.string().datetime()
const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema)
]))

export const agentRunStatusSchema = z.enum([
  'queued',
  'contextualizing',
  'waiting-model-approval',
  'model-requesting',
  'validating-model-output',
  'planning',
  'policy-check',
  'waiting-approval',
  'executing',
  'validating',
  'responding',
  'waiting-input',
  'completed',
  'failed',
  'cancelled'
])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>
export const agentModeSchema = z.enum(['auto', 'environment', 'explain', 'diagnose', 'solve', 'project', 'review', 'edit', 'chat'])
export type AgentMode = z.infer<typeof agentModeSchema>

export const agentStepKindSchema = z.enum(['reason', 'resource', 'tool', 'approval', 'validate', 'respond', 'learning'])
export const agentStepStatusSchema = z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled'])

export const agentStepSchema = z.object({
  id: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  kind: agentStepKindSchema,
  status: agentStepStatusSchema,
  toolName: z.string().min(1).max(120).optional(),
  summary: z.string().max(20_000).optional(),
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional()
})
export type AgentStep = z.infer<typeof agentStepSchema>

export const contextSourceSchema = z.object({
  kind: z.enum(['selection', 'file', 'diagnostic', 'problem', 'project-tree', 'learning', 'memory', 'screenshot', 'tool']),
  label: z.string().min(1).max(500),
  content: z.string().max(100_000),
  trusted: z.boolean(),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  relativePath: z.string().max(1_024).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional()
})
export type ContextSource = z.infer<typeof contextSourceSchema>

export const explanationContextSchema = z.object({
  knownConceptIds: z.array(z.string().min(1).max(100)).max(100),
  focusConceptIds: z.array(z.string().min(1).max(100)).max(100),
  unseenConceptIds: z.array(z.string().min(1).max(100)).max(100),
  instructions: z.string().min(1).max(5_000)
})
export type ExplanationContext = z.infer<typeof explanationContextSchema>

export const contextPacketSchema = z.object({
  requestId: z.string().uuid(),
  sources: z.array(contextSourceSchema).max(32),
  conceptIds: z.array(z.string().min(1).max(100)).max(100),
  explanationContext: explanationContextSchema.optional(),
  tokenEstimate: z.number().int().nonnegative().max(100_000),
  truncated: z.boolean().default(false)
})
export type ContextPacket = z.infer<typeof contextPacketSchema>

export const toolRiskSchema = z.enum(['L0', 'L1', 'L2', 'L3'])
export type ToolRisk = z.infer<typeof toolRiskSchema>

export const toolDescriptorSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  risk: toolRiskSchema,
  timeoutMs: z.number().int().positive().max(300_000),
  owner: z.string().min(1).max(100),
  inputSchema: z.record(z.string(), jsonValueSchema)
})
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>

export const artifactRefSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['file', 'build', 'test-report', 'diagnostic', 'snapshot', 'screenshot', 'trace']),
  label: z.string().min(1).max(500),
  uri: z.string().max(2_048).optional()
})
export type ArtifactRef = z.infer<typeof artifactRefSchema>

export const sideEffectSchema = z.object({
  kind: z.enum(['write-file', 'create-file', 'delete-file', 'run-program', 'start-debugger', 'persist-state', 'remote-request']),
  target: z.string().min(1).max(2_048),
  summary: z.string().min(1).max(2_000)
})
export type SideEffect = z.infer<typeof sideEffectSchema>

export const toolResultSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number().int().nullable(),
  summary: z.string().max(20_000),
  structuredContent: jsonValueSchema.optional(),
  diagnostics: z.array(diagnosticSchema).max(1_000),
  artifacts: z.array(artifactRefSchema).max(100),
  sideEffects: z.array(sideEffectSchema).max(100),
  retryable: z.boolean(),
  errorCode: z.string().max(100).optional(),
  durationMs: z.number().int().nonnegative()
})
export type ToolResult<T = unknown> = Omit<z.infer<typeof toolResultSchema>, 'structuredContent'> & { structuredContent?: T }

export const toolCallSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepId: z.string().min(1).max(100),
  serverName: z.string().min(1).max(100),
  toolName: z.string().min(1).max(120),
  risk: toolRiskSchema,
  parameterSummary: z.record(z.string(), jsonValueSchema),
  result: toolResultSchema.optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorCode: z.string().max(100).optional()
})
export type ToolCall = z.infer<typeof toolCallSchema>

export const approvalSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepId: z.string().min(1).max(100),
  toolName: z.string().min(1).max(120),
  risk: toolRiskSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  parameterSummary: z.record(z.string(), jsonValueSchema),
  diff: z.string().max(100_000).optional(),
  sideEffects: z.array(z.string().min(1).max(500)).max(100),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  decisionReason: z.string().max(2_000).optional(),
  createdAt: timestampSchema,
  decidedAt: timestampSchema.optional()
})
export type Approval = z.infer<typeof approvalSchema>

export const approvalDecisionSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2_000).optional(),
  rememberForRun: z.boolean().default(false)
})
export type ApprovalDecision = z.input<typeof approvalDecisionSchema>

export const timelineEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(['request', 'intent', 'context', 'plan', 'policy', 'approval', 'tool', 'progress', 'validation', 'response', 'learning', 'error', 'cancelled']),
  status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']),
  title: z.string().min(1).max(200),
  summary: z.string().max(20_000),
  occurredAt: timestampSchema,
  stepId: z.string().max(100).optional(),
  data: z.record(z.string(), jsonValueSchema).optional()
})
export type TimelineEvent = z.infer<typeof timelineEventSchema>

export const agentRunSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  source: z.enum(['main', 'editor', 'pet', 'screenshot', 'system']),
  mode: agentModeSchema,
  message: z.string().min(1).max(20_000),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  activeFile: z.string().max(1_024).optional(),
  conversationId: z.string().uuid().optional(),
  assistantMessageId: z.string().uuid().optional(),
  status: agentRunStatusSchema,
  intent: z.string().max(200).optional(),
  planSummary: z.string().max(20_000).optional(),
  response: z.string().max(100_000).optional(),
  validationSummary: z.string().max(20_000).optional(),
  errorCode: z.string().max(100).optional(),
  errorMessage: z.string().max(20_000).optional(),
  steps: z.array(agentStepSchema).max(100),
  pendingApproval: approvalSchema.optional(),
  pendingClarification: z.object({
    question: z.string().min(1).max(2_000),
    requestedAt: timestampSchema
  }).strict().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional()
}).superRefine((run, context) => {
  if (Boolean(run.conversationId) !== Boolean(run.assistantMessageId)) {
    context.addIssue({ code: 'custom', path: ['conversationId'], message: '对话任务必须同时关联 conversationId 和 assistantMessageId。' })
  }
})
export type AgentRun = z.infer<typeof agentRunSchema>

export const agentRunDetailSchema = agentRunSchema.extend({
  timeline: z.array(timelineEventSchema),
  approvals: z.array(approvalSchema),
  toolCalls: z.array(toolCallSchema)
})
export type AgentRunDetail = z.infer<typeof agentRunDetailSchema>

export const screenshotRefSchema = z.object({
  id: z.string().uuid(),
  previewDataUrl: z.string().startsWith('data:image/').max(5_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: timestampSchema
})
export type ScreenshotRef = z.infer<typeof screenshotRefSchema>

export const agentStartRequestSchema = z.object({
  requestId: z.string().uuid().default(() => crypto.randomUUID()),
  source: z.enum(['main', 'editor', 'pet', 'screenshot', 'system']),
  mode: agentModeSchema,
  message: z.string().min(1).max(20_000),
  projectId: z.preprocess(value => (value === '' || value === null ? undefined : value), z.string().uuid().optional()),
  activeFile: z.string().max(1_024).optional(),
  conversationId: z.string().uuid().optional(),
  assistantMessageId: z.string().uuid().optional(),
  selection: z.object({
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
    content: z.string().max(100_000)
  }).optional(),
  diagnostics: z.array(diagnosticSchema).max(200).optional(),
  screenshot: screenshotRefSchema.optional(),
  reviewItemId: z.string().uuid().optional(),
  reviewOutcome: z.enum(['passed', 'failed']).optional()
}).superRefine((request, context) => {
  if (Boolean(request.conversationId) !== Boolean(request.assistantMessageId)) {
    context.addIssue({ code: 'custom', path: ['conversationId'], message: '对话任务必须同时关联 conversationId 和 assistantMessageId。' })
  }
  if (request.mode === 'review' && (!request.reviewItemId || !request.reviewOutcome)) {
    context.addIssue({ code: 'custom', path: ['reviewItemId'], message: '复习请求必须引用具体复习项和结果。' })
  }
  if (request.mode !== 'review' && (request.reviewItemId || request.reviewOutcome)) {
    context.addIssue({ code: 'custom', path: ['reviewItemId'], message: '只有复习请求可以引用复习项。' })
  }
})
export type AgentStartRequest = z.input<typeof agentStartRequestSchema>

export const agentContinueRequestSchema = z.object({
  runId: z.string().uuid(),
  message: z.string().min(1).max(20_000).refine(value => value.trim().length > 0, '补充信息不能为空。'),
  assistantMessageId: z.string().uuid().optional()
}).strict()
export type AgentContinueRequest = z.input<typeof agentContinueRequestSchema>

export const modelProviderSchema = z.enum(['openai', 'deepseek', 'custom'])
export type ModelProvider = z.infer<typeof modelProviderSchema>

export const modelProtocolSchema = z.enum(['auto', 'openai-responses', 'openai-chat-completions'])
export type ModelProtocol = z.infer<typeof modelProtocolSchema>

export const modelCapabilitiesSchema = z.object({
  text: z.boolean().default(true),
  vision: z.boolean().default(false),
  toolCalling: z.boolean().default(true),
  structuredOutput: z.boolean().default(true)
}).strict()
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>

export const modelProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  provider: modelProviderSchema,
  protocol: modelProtocolSchema,
  baseUrl: z.string().url().max(2_048),
  model: z.string().min(1).max(200),
  capabilities: modelCapabilitiesSchema,
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  apiKeyConfigured: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type ModelProfile = z.infer<typeof modelProfileSchema>

export const modelProfileInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  provider: modelProviderSchema.default('custom'),
  protocol: modelProtocolSchema.default('auto'),
  baseUrl: z.string().url().max(2_048),
  model: z.string().min(1).max(200),
  capabilities: modelCapabilitiesSchema.default({
    text: true,
    vision: false,
    toolCalling: true,
    structuredOutput: true
  }),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  apiKey: z.string().min(1).max(10_000).optional()
})
export type ModelProfileInput = z.input<typeof modelProfileInputSchema>
