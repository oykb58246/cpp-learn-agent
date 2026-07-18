import { z } from 'zod'
import { diagnosticSchema, type Diagnostic } from './future'
import { agentModeSchema, agentRunSchema } from './agent'

const timestampSchema = z.string().datetime()
const relativePathSchema = z.string().min(1).max(1_024).refine(value => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value)) return false
  return !value.split(/[\\/]+/).some(segment => segment === '..')
}, '路径必须是工作区内的相对路径')

export const diagnosticFailureKindSchema = z.enum(['compile', 'linker', 'runtime', 'nonzero-exit', 'timeout'])
export type DiagnosticFailureKind = z.infer<typeof diagnosticFailureKindSchema>

export const diagnosticIncidentStatusSchema = z.enum(['active', 'resolved', 'superseded'])
export type DiagnosticIncidentStatus = z.infer<typeof diagnosticIncidentStatusSchema>

export const diagnosticOccurrenceSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  file: relativePathSchema.optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  rawMessage: z.string().min(1).max(20_000),
  normalizedMessage: z.string().min(1).max(20_000)
})
export type DiagnosticOccurrence = z.infer<typeof diagnosticOccurrenceSchema>

export const diagnosticGroupSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  fingerprint: z.string().min(1).max(128),
  source: diagnosticSchema.shape.source,
  code: z.string().max(200).optional(),
  failureKind: diagnosticFailureKindSchema,
  severity: diagnosticSchema.shape.severity,
  title: z.string().min(1).max(500),
  normalizedTemplate: z.string().min(1).max(20_000),
  occurrenceCount: z.number().int().positive(),
  createdAt: timestampSchema,
  occurrences: z.array(diagnosticOccurrenceSchema).min(1).max(1_000)
})
export type DiagnosticGroup = z.infer<typeof diagnosticGroupSchema>

export const diagnosticIncidentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  attemptId: z.string().uuid(),
  targetKey: z.string().min(1).max(2_048),
  operation: z.enum(['build', 'run']),
  failureKinds: z.array(diagnosticFailureKindSchema).min(1).max(5),
  status: diagnosticIncidentStatusSchema,
  acknowledgedAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  resolvedAt: timestampSchema.optional(),
  groups: z.array(diagnosticGroupSchema).max(200)
})
export type DiagnosticIncidentDetail = z.infer<typeof diagnosticIncidentSchema>

export const diagnosticInboxGroupSchema = z.object({
  fingerprint: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  source: diagnosticSchema.shape.source,
  code: z.string().max(200).optional(),
  failureKind: diagnosticFailureKindSchema,
  severity: diagnosticSchema.shape.severity,
  occurrenceCount: z.number().int().positive(),
  occurrences: z.array(diagnosticOccurrenceSchema).min(1).max(2_000),
  incidentIds: z.array(z.string().uuid()).min(1).max(100)
})
export type DiagnosticInboxGroup = z.infer<typeof diagnosticInboxGroupSchema>

export const diagnosticInboxChangedEventSchema = z.object({
  projectId: z.string().uuid(),
  groups: z.array(diagnosticInboxGroupSchema).max(500),
  attention: z.boolean()
})
export type DiagnosticInboxChangedEvent = z.infer<typeof diagnosticInboxChangedEventSchema>

export const editorSelectionSchema = z.object({
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive(),
  content: z.string().min(1).max(100_000)
})
export type EditorSelection = z.infer<typeof editorSelectionSchema>

export const diagnosticExplanationSnapshotSchema = z.object({
  fingerprint: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  failureKind: diagnosticFailureKindSchema,
  occurrenceCount: z.number().int().positive(),
  occurrences: z.array(diagnosticOccurrenceSchema).min(1).max(2_000),
  incidentIds: z.array(z.string().uuid()).min(1).max(100)
})
export type DiagnosticExplanationSnapshot = z.infer<typeof diagnosticExplanationSnapshotSchema>

export const agentConversationStatusSchema = z.enum(['active', 'archived'])
export type AgentConversationStatus = z.infer<typeof agentConversationStatusSchema>

export const agentConversationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  status: agentConversationStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type AgentConversation = z.infer<typeof agentConversationSchema>

export const agentMessageRoleSchema = z.enum(['user', 'assistant'])
export const agentMessageKindSchema = z.enum(['text', 'diagnostic-explanation'])
export const agentMessageStatusSchema = z.enum(['pending', 'streaming', 'completed', 'stopped', 'failed', 'interrupted'])
export type AgentMessageStatus = z.infer<typeof agentMessageStatusSchema>

export const agentMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: agentMessageRoleSchema,
  kind: agentMessageKindSchema,
  content: z.string().max(100_000),
  status: agentMessageStatusSchema,
  diagnosticSnapshot: diagnosticExplanationSnapshotSchema.optional(),
  errorCode: z.string().max(100).optional(),
  errorMessage: z.string().max(20_000).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional()
}).superRefine((message, context) => {
  if (message.role === 'user' && !message.content.trim()) {
    context.addIssue({ code: 'custom', path: ['content'], message: '用户消息不能为空。' })
  }
  if (message.role === 'assistant' && message.status === 'completed' && !message.content.trim()) {
    context.addIssue({ code: 'custom', path: ['content'], message: '已完成回答不能为空。' })
  }
})
export type AgentMessage = z.infer<typeof agentMessageSchema>
export const conversationChangedEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation'), projectId: z.string().uuid(), conversation: agentConversationSchema }),
  z.object({ kind: z.literal('message'), projectId: z.string().uuid(), message: agentMessageSchema })
])
export type ConversationChangedEvent = z.infer<typeof conversationChangedEventSchema>

export const conversationSendInputSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(20_000),
  mode: agentModeSchema.optional(),
  activeFile: relativePathSchema.optional(),
  selection: editorSelectionSchema.optional(),
  diagnostic: diagnosticExplanationSnapshotSchema.optional(),
  diagnostics: z.array(diagnosticSchema).max(200).optional()
})
export type ConversationSendInput = z.input<typeof conversationSendInputSchema>

export const conversationMessageDeltaSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  delta: z.string().min(1).max(20_000)
})
export type ConversationMessageDelta = z.infer<typeof conversationMessageDeltaSchema>

export const conversationCreateInputSchema = z.object({ projectId: z.string().uuid(), title: z.string().trim().min(1).max(200).optional() })
export const conversationArchiveInputSchema = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid() })
export const conversationMessagesInputSchema = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid() })
export const conversationStopInputSchema = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid() })
export const conversationRetryInputSchema = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid(), messageId: z.string().uuid() })
export const diagnosticsProjectInputSchema = z.object({ projectId: z.string().uuid() })
export type ConversationCreateInput = z.input<typeof conversationCreateInputSchema>
export type ConversationArchiveInput = z.infer<typeof conversationArchiveInputSchema>
export type ConversationMessagesInput = z.infer<typeof conversationMessagesInputSchema>
export type ConversationStopInput = z.infer<typeof conversationStopInputSchema>
export type ConversationRetryInput = z.infer<typeof conversationRetryInputSchema>
export const conversationSendResultSchema = z.object({ user: agentMessageSchema, assistant: agentMessageSchema })
export type ConversationSendResult = z.infer<typeof conversationSendResultSchema>
export const conversationAgentSubmitResultSchema = conversationSendResultSchema.extend({ run: agentRunSchema })
export type ConversationAgentSubmitResult = z.infer<typeof conversationAgentSubmitResultSchema>

export type DiagnosticWithFailureKind = { kind: DiagnosticFailureKind; diagnostic: Diagnostic }
