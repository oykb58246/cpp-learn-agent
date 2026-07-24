import {
  agentContinueRequestSchema,
  agentStartRequestSchema,
  cppPilotContextEnvelopeSchema,
  cppPilotFinalResponseSchema,
  cppPilotToolOutputSchema,
  openAiResponseOutputItemSchema,
  type AgentContinueRequest,
  type AgentRun,
  type AgentRunDetail,
  type AgentStartRequest,
  type Approval,
  type ApprovalDecision,
  type CppPilotContextEnvelope,
  type CppPilotFinalResponse,
  type CppPilotToolOutcome,
  type CppPilotToolOutput,
  type ModelProfile,
  type OpenAiFunctionTool,
  type OpenAiResponseOutputItem,
  type TimelineEvent,
  type ToolCall,
  type ToolResult,
  type ToolRisk
} from '@cpp-pet/contracts'
import { z } from 'zod'
import type {
  AgentRuntimeController,
  ResolvedAgentRequest,
  RuntimeSessionRecord,
  RuntimeStore,
  RuntimeToolClient
} from './runtime'
import type { OpenAiResponseInputItem, OpenAiResponsesResult } from './responses-client'
import { OpenAiResponsesError } from './responses-client'
import { sanitizeModelVisibleText } from './model-visible'
import { CPPPILOT_OPENAI_INSTRUCTIONS } from './openai-instructions'

export interface OpenAiAgentContextBuilder {
  build(
    request: ResolvedAgentRequest,
    taskId: string,
    turn: number,
    signal: AbortSignal
  ): Promise<CppPilotContextEnvelope>
}

export interface OpenAiAgentModel {
  profile: ModelProfile
  tools: OpenAiFunctionTool[]
  respond(input: OpenAiResponseInputItem[], signal: AbortSignal): Promise<OpenAiResponsesResult>
}

export interface OpenAiAgentModelFactory {
  create(signal: AbortSignal): Promise<OpenAiAgentModel | undefined>
}

interface AgentToolDefinition {
  name: string
  title: string
  description: string
  risk: ToolRisk
  timeoutMs: number
}

export interface OpenAiAgentToolRegistry {
  readonly tools: OpenAiFunctionTool[]
  resolve(functionName: string): AgentToolDefinition | undefined
  parse(functionName: string, args: unknown, bindings: { runId: string }): {
    definition: AgentToolDefinition
    arguments: Record<string, unknown>
  }
}

export interface OpenAiAgentRuntimeOptions {
  store: RuntimeStore
  contextBuilder: OpenAiAgentContextBuilder
  modelFactory: OpenAiAgentModelFactory
  registry: OpenAiAgentToolRegistry
  toolClient: RuntimeToolClient
  totalTimeoutMs?: number
  maxModelTurns?: number
  maxToolCalls?: number
  maxSessionItems?: number
  maxSessionBytes?: number
}

interface PendingToolCall {
  item: Extract<OpenAiResponseOutputItem, { type: 'function_call' }>
  definition: AgentToolDefinition
  arguments: Record<string, unknown>
  stepId: string
}

interface FileReadState {
  projectId: string
  relativePath: string
  content: string
  contentHash: string
  modelContentComplete: boolean
}

interface OpenAiExecutionState {
  request: ResolvedAgentRequest
  run: AgentRun
  controller: AbortController
  remainingTimeMs: number
  activeSince?: number
  model?: OpenAiAgentModel
  modelProfileId?: string
  modelContract?: string
  context?: CppPilotContextEnvelope
  input: OpenAiResponseInputItem[]
  modelTurns: number
  toolCalls: number
  evidence: Map<string, CppPilotToolOutput>
  failedCallSignatures: Set<string>
  fileReads: Map<string, FileReadState>
  grantedProjectIds: Set<string>
  grantedPaths: Set<string>
  grantedBuildIds: Set<string>
  grantedSessionIds: Set<string>
  finalRepairAttempts: number
  pendingCall?: PendingToolCall
  remoteContextApproved: boolean
}

const storedFunctionCallSchema = openAiResponseOutputItemSchema.refine(
  (item): item is Extract<OpenAiResponseOutputItem, { type: 'function_call' }> => item.type === 'function_call',
  'Pending session item must be a function call.'
)

const openAiSessionStateSchema = z.object({
  request: agentStartRequestSchema,
  context: cppPilotContextEnvelopeSchema,
  input: z.array(z.record(z.string(), z.unknown())).max(1_000),
  modelProfileId: z.string().uuid(),
  modelContract: z.string().min(1).max(2_097_152),
  modelTurns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  evidence: z.array(z.tuple([z.string().min(1).max(200), cppPilotToolOutputSchema])).max(100),
  failedCallSignatures: z.array(z.string().min(1).max(100_000)).max(100),
  fileReads: z.array(z.tuple([
    z.string().min(1).max(1_300),
    z.object({
      projectId: z.string().uuid(),
      relativePath: z.string().min(1).max(1_024),
      content: z.string().max(2_097_152),
      contentHash: z.string().min(1).max(200),
      modelContentComplete: z.boolean()
    }).strict()
  ])).max(500),
  grantedProjectIds: z.array(z.string().uuid()).max(100),
  grantedPaths: z.array(z.string().min(1).max(1_300)).max(1_000),
  grantedBuildIds: z.array(z.string().min(1).max(200)).max(100),
  grantedSessionIds: z.array(z.string().min(1).max(200)).max(100),
  finalRepairAttempts: z.number().int().nonnegative().max(1),
  pendingCall: z.object({
    item: storedFunctionCallSchema,
    arguments: z.record(z.string(), z.unknown()),
    stepId: z.string().min(1).max(100)
  }).strict().optional(),
  remoteContextApproved: z.boolean(),
  remainingTimeMs: z.number().int().nonnegative().max(300_000)
}).strict()

class AgentLoopFailure extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AgentLoopFailure'
  }
}


function resolveApprovalMode(policy: { approvalMode?: 'always' | 'on-risk' | 'full'; writesRequireApproval?: boolean } | undefined): 'always' | 'on-risk' | 'full' {
  if (policy?.approvalMode === 'always' || policy?.approvalMode === 'on-risk' || policy?.approvalMode === 'full') return policy.approvalMode
  if (policy?.writesRequireApproval === false) return 'full'
  return 'on-risk'
}

function shouldRequireApproval(
  policy: { approvalMode?: 'always' | 'on-risk' | 'full'; writesRequireApproval?: boolean } | undefined,
  risk: ToolRisk,
  kind: 'remote-context' | 'tool'
): boolean {
  const mode = resolveApprovalMode(policy)
  if (mode === 'full') return false
  if (mode === 'always') return true
  // on-risk: remote model context + L2/L3 tools
  if (kind === 'remote-context') return true
  return risk === 'L2' || risk === 'L3'
}
export class OpenAiAgentRuntime implements AgentRuntimeController {
  private readonly executions = new Map<string, OpenAiExecutionState>()
  private readonly listeners = new Set<(run: AgentRun) => void>()
  private readonly activeActions = new Set<string>()
  private readonly totalTimeoutMs: number
  private readonly maxModelTurns: number
  private readonly maxToolCalls: number
  private readonly maxSessionItems: number
  private readonly maxSessionBytes: number

  constructor(private readonly options: OpenAiAgentRuntimeOptions) {
    this.totalTimeoutMs = options.totalTimeoutMs ?? 120_000
    this.maxModelTurns = options.maxModelTurns ?? 12
    this.maxToolCalls = options.maxToolCalls ?? 20
    this.maxSessionItems = options.maxSessionItems ?? 512
    this.maxSessionBytes = options.maxSessionBytes ?? 8 * 1_024 * 1_024
  }

  onChanged(listener: (run: AgentRun) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(input: AgentStartRequest): Promise<AgentRun> {
    const request = agentStartRequestSchema.parse(input)
    const now = new Date().toISOString()
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: request.requestId, source: request.source, mode: request.mode,
      message: request.message, status: 'queued', steps: [], createdAt: now, updatedAt: now,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.activeFile ? { activeFile: request.activeFile } : {}),
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      ...(request.assistantMessageId ? { assistantMessageId: request.assistantMessageId } : {})
    }
    const state: OpenAiExecutionState = {
      request, run, controller: new AbortController(), remainingTimeMs: this.totalTimeoutMs, activeSince: Date.now(),
      input: [], modelTurns: 0, toolCalls: 0, evidence: new Map(), failedCallSignatures: new Set(), fileReads: new Map(),
      grantedProjectIds: new Set(), grantedPaths: new Set(), grantedBuildIds: new Set(), grantedSessionIds: new Set(),
      finalRepairAttempts: 0, remoteContextApproved: false
    }
    this.executions.set(run.id, state)
    await this.options.store.create(run)
    this.publish(run)
    await this.timeline(state, 'request', 'completed', '收到请求', request.message)

    await this.guard(state, async () => {
      await this.setStatus(state, 'contextualizing')
      const model = await this.withDeadline(state, signal => this.options.modelFactory.create(signal))
      if (!model) throw new AgentLoopFailure('MODEL_NOT_CONFIGURED', '未配置可用的 OpenAI Responses 模型或 API Key。')
      state.model = model
      state.modelProfileId = model.profile.id
      state.modelContract = modelContractFor(model)
      state.context = cppPilotContextEnvelopeSchema.parse(
        await this.withDeadline(state, signal => this.options.contextBuilder.build(request, request.requestId, 0, signal))
      )
      this.chargeActiveBudget(state)
      state.remainingTimeMs = Math.min(state.remainingTimeMs, state.context.policy.remainingTimeMs)
      state.activeSince = Date.now()
      this.grantInitialCapabilities(state)
      if (state.context.taskId !== request.requestId) {
        throw new AgentLoopFailure('CONTEXT_PROTOCOL_INVALID', '上下文 taskId 与请求不一致。')
      }
      await this.timeline(state, 'context', 'completed', '构建模型上下文', contextSummary(state.context))
      if (shouldRequireApproval(state.context.policy, 'L3', 'remote-context')) {
        await this.requestRemoteApproval(state)
      } else {
        state.remoteContextApproved = true
        this.appendApprovedRemoteContext(state)
        await this.timeline(state, 'approval', 'completed', '审批策略：完全访问，跳过上下文审批', 'full')
        await this.drive(state)
      }
    })
    return structuredClone(run)
  }

  async continue(input: AgentContinueRequest): Promise<AgentRun> {
    const continuation = agentContinueRequestSchema.parse(input)
    const state = this.executions.get(continuation.runId)
    if (!state) throw new Error('Agent run is not active')
    if (state.run.status !== 'waiting-input') throw new Error('Agent run is not waiting for input')
    const release = this.claimAction(`continue:${state.run.id}`)
    try {
      this.resumeBudget(state)
      if (continuation.assistantMessageId) state.run.assistantMessageId = continuation.assistantMessageId
      state.run.pendingClarification = undefined
      state.input.push({ role: 'user', content: [{ type: 'input_text', text: continuation.message }] })
      await this.timeline(state, 'request', 'completed', '收到补充信息', continuation.message)
      await this.guard(state, () => this.drive(state))
      return structuredClone(state.run)
    } finally {
      release()
    }
  }

  async restore(): Promise<string[]> {
    const restored: string[] = []
    for (const session of this.options.store.listSessions()) {
      if (session.protocol !== 'cpppilot.openai-session.v1') {
        await this.options.store.deleteSession(session.runId)
        continue
      }
      const detail = this.options.store.get(session.runId)
      const parsed = openAiSessionStateSchema.safeParse(session.state)
      if (!detail || !parsed.success || !isRestorableStatus(detail.status)) {
        await this.options.store.deleteSession(session.runId)
        continue
      }
      const stored = parsed.data
      if (stored.request.requestId !== detail.requestId || stored.context.taskId !== detail.requestId) {
        await this.options.store.deleteSession(session.runId)
        continue
      }
      if (detail.status === 'waiting-input' && !detail.pendingClarification) {
        await this.options.store.deleteSession(session.runId)
        continue
      }
      const state: OpenAiExecutionState = {
        request: stored.request,
        run: detail,
        controller: new AbortController(),
        remainingTimeMs: stored.remainingTimeMs,
        modelProfileId: stored.modelProfileId,
        modelContract: stored.modelContract,
        context: stored.context,
        input: stored.input,
        modelTurns: stored.modelTurns,
        toolCalls: stored.toolCalls,
        evidence: new Map(stored.evidence),
        failedCallSignatures: new Set(stored.failedCallSignatures),
        fileReads: new Map(stored.fileReads),
        grantedProjectIds: new Set(stored.grantedProjectIds),
        grantedPaths: new Set(stored.grantedPaths),
        grantedBuildIds: new Set(stored.grantedBuildIds),
        grantedSessionIds: new Set(stored.grantedSessionIds),
        finalRepairAttempts: stored.finalRepairAttempts,
        remoteContextApproved: stored.remoteContextApproved
      }
      let pendingCall: PendingToolCall | undefined
      try {
        if (stored.pendingCall) pendingCall = this.validateRestoredPendingCall(state, stored.pendingCall)
        if (detail.status === 'waiting-approval' && !pendingCall) throw new Error('Pending approval call is missing')
        if (detail.status !== 'waiting-approval' && pendingCall) throw new Error('Unexpected pending call for restored status')
        if (
          detail.status === 'waiting-model-approval'
          && (detail.pendingApproval?.toolName !== 'model.remote-context' || detail.pendingApproval.stepId !== 'model-context')
        ) throw new Error('Remote-context approval is invalid')
      } catch {
        await this.options.store.deleteSession(session.runId)
        continue
      }
      if (pendingCall) state.pendingCall = pendingCall
      this.executions.set(detail.id, state)
      restored.push(detail.id)
    }
    return restored
  }

  get(runId: string): AgentRunDetail | undefined { return this.options.store.get(runId) }
  list(): AgentRun[] { return this.options.store.list() }

  async decide(input: ApprovalDecision): Promise<AgentRun> {
    const state = [...this.executions.values()].find(candidate => candidate.run.pendingApproval?.id === input.approvalId)
    if (!state?.run.pendingApproval) throw new Error('Approval is not pending')
    const release = this.claimAction(`approval:${input.approvalId}`)
    try {
      this.resumeBudget(state)
      const pending = state.run.pendingApproval
      const decided: Approval = {
        ...pending, status: input.decision, decidedAt: new Date().toISOString(),
        ...(input.reason ? { decisionReason: input.reason } : {})
      }
      await this.options.store.saveApproval(decided)
      state.run.pendingApproval = undefined
      await this.timeline(
        state, 'approval', 'completed', input.decision === 'approved' ? '审批通过' : '审批拒绝',
        input.reason ?? pending.title, pending.stepId
      )

      await this.guard(state, async () => {
        if (pending.toolName === 'model.remote-context') {
          if (input.decision === 'rejected') {
            state.run.response = input.reason ? `模型上下文发送已拒绝：${input.reason}` : '模型上下文发送已拒绝。'
            await this.setStatus(state, 'cancelled')
            state.run.completedAt = state.run.updatedAt
            await this.persist(state)
            this.executions.delete(state.run.id)
            return
          }
          state.remoteContextApproved = true
          this.appendApprovedRemoteContext(state)
          await this.drive(state)
          return
        }

        if (!state.pendingCall || state.pendingCall.stepId !== pending.stepId) {
          throw new AgentLoopFailure('APPROVAL_STATE_INVALID', '审批与待执行模型调用不一致。')
        }
        if (input.decision === 'rejected') {
          const output = this.rejectedToolOutput(state, state.pendingCall, input.reason)
          await this.recordObservation(state, state.pendingCall, output, 'cancelled')
          delete state.pendingCall
          await this.drive(state)
          return
        }
        await this.ensureModel(state)
        const call = state.pendingCall
        delete state.pendingCall
        await this.executeTool(state, call)
        await this.drive(state)
      })
      return structuredClone(state.run)
    } finally {
      release()
    }
  }

  async cancel(runId: string): Promise<AgentRun> {
    const state = this.executions.get(runId)
    if (!state) {
      const existing = this.options.store.get(runId)
      if (!existing) throw new Error('Agent run not found')
      return existing
    }
    const cancelledAt = new Date().toISOString()
    state.controller.abort(new Error('Agent run cancelled'))
    if (state.run.pendingApproval) {
      await this.options.store.saveApproval({
        ...state.run.pendingApproval,
        status: 'expired',
        decisionReason: 'Agent run cancelled',
        decidedAt: cancelledAt
      })
    }
    state.run.pendingApproval = undefined
    state.run.pendingClarification = undefined
    state.run.steps = state.run.steps.map(step => (
      ['completed', 'failed', 'cancelled'].includes(step.status)
        ? step
        : { ...step, status: 'cancelled', finishedAt: cancelledAt }
    ))
    state.run.response = '任务已取消。'
    await this.setStatus(state, 'cancelled')
    state.run.completedAt = state.run.updatedAt
    await this.persist(state)
    await this.timeline(state, 'cancelled', 'cancelled', '任务取消', '用户停止了 Agent 任务。')
    this.executions.delete(runId)
    return structuredClone(state.run)
  }

  async shutdown(): Promise<void> {
    const cancellations: Promise<AgentRun>[] = []
    for (const [runId, state] of this.executions) {
      if (isRestorableStatus(state.run.status)) {
        await this.persist(state)
        this.executions.delete(runId)
      } else {
        cancellations.push(this.cancel(runId))
      }
    }
    await Promise.all(cancellations)
  }


  private appendApprovedRemoteContext(state: OpenAiExecutionState): void {
    if (!state.context) throw new AgentLoopFailure('AGENT_STATE_INVALID', '模型上下文尚未准备。')
    const already = state.input.some(item => {
      if (item.role !== 'user' || !Array.isArray(item.content)) return false
      return (item.content as Array<Record<string, unknown>>).some(part => (
        part?.type === 'input_text'
        && typeof part.text === 'string'
        && part.text.includes('cpppilot.context.v1')
      ))
    })
    if (already) return
    const contextContent: Record<string, unknown>[] = [{
      type: 'input_text', text: JSON.stringify(state.context)
    }]
    if (state.request.screenshot) {
      contextContent.push({
        type: 'input_image', image_url: state.request.screenshot.previewDataUrl, detail: 'auto'
      })
    }
    state.input.push({ role: 'user', content: contextContent })
  }

  private async requestRemoteApproval(state: OpenAiExecutionState): Promise<void> {
    if (!state.model || !state.context) throw new AgentLoopFailure('AGENT_STATE_INVALID', '模型上下文尚未准备。')
    const contextBytes = new TextEncoder().encode(JSON.stringify(state.context)).byteLength
    const approval: Approval = {
      id: crypto.randomUUID(), runId: state.run.id, stepId: 'model-context', toolName: 'model.remote-context',
      risk: 'L3', title: '发送上下文到 OpenAI 模型',
      description: `将当前任务的受限上下文发送到模型配置“${state.model.profile.name}”。`,
      parameterSummary: {
        profile: state.model.profile.name,
        endpoint: `${state.model.profile.baseUrl.replace(/\/$/, '')}/responses`,
        model: state.model.profile.model,
        toolCount: state.model.tools.length,
        contextBytes,
        activeFile: state.context.task.activeFile ?? null,
        relatedFiles: state.context.workspace.relatedFiles.length,
        promptCharacters: state.context.task.prompt.length,
        diagnostics: {
          count: state.context.workspace.diagnostics.length,
          sources: [...new Set(state.context.workspace.diagnostics.map(item => item.source))]
        },
        memory: {
          recentConversation: state.context.memory.recentConversation.length,
          learnerProfileFields: Object.keys(state.context.memory.learnerProfile).length,
          knowledgeState: state.context.memory.knowledgeState.length,
          relevantErrors: state.context.memory.relevantErrors.length,
          dueReviews: state.context.memory.dueReviews.length,
          recentEvidence: state.context.memory.recentEvidence.length
        },
        ...(state.request.screenshot ? {
          screenshot: {
            id: state.request.screenshot.id,
            mimeType: state.request.screenshot.mimeType,
            width: state.request.screenshot.width,
            height: state.request.screenshot.height,
            bytes: new TextEncoder().encode(state.request.screenshot.previewDataUrl).byteLength
          }
        } : {})
      },
      sideEffects: ['remote-request'], status: 'pending', createdAt: new Date().toISOString()
    }
    state.run.pendingApproval = approval
    await this.options.store.saveApproval(approval)
    await this.setStatus(state, 'waiting-model-approval')
    await this.timeline(state, 'approval', 'waiting', '等待模型上下文审批', approval.description, approval.stepId)
  }

  private async drive(state: OpenAiExecutionState): Promise<void> {
    await this.ensureModel(state)
    if (!state.context || !state.remoteContextApproved) {
      throw new AgentLoopFailure('AGENT_STATE_INVALID', '模型循环尚未准备。')
    }
    // Defensive: every entry into the model loop must carry cpppilot.context.v1
    // (covers approve / full-skip / resume paths).
    this.appendApprovedRemoteContext(state)
    while (!isTerminal(state.run.status)) {
      this.checkDeadline(state)
      this.checkSessionBudget(state)
      const maxTurns = Math.min(this.maxModelTurns, state.context.policy.maxModelTurns)
      if (state.modelTurns >= maxTurns) throw new AgentLoopFailure('MODEL_TURN_LIMIT', `模型轮次超过上限 ${maxTurns}。`)
      state.modelTurns += 1
      await this.setStatus(state, 'model-requesting')
      const response = await this.withDeadline(
        state,
        signal => state.model!.respond(structuredClone(state.input), signal),
        {
          timeoutMs: state.model!.profile.timeoutMs,
          code: 'MODEL_TIMEOUT',
          message: `OpenAI Responses request exceeded the configured ${state.model!.profile.timeoutMs} ms timeout.`
        }
      )
      await this.setStatus(state, 'validating-model-output')
      const unsettled = response.output.find(item => (
        (item.type === 'function_call' || item.type === 'message')
        && item.status !== undefined
        && item.status !== 'completed'
      ))
      if (unsettled) {
        throw new AgentLoopFailure(
          'MODEL_PROTOCOL_INVALID',
          `OpenAI output item ${unsettled.id} has non-terminal status ${unsettled.status}.`
        )
      }
      state.input.push(...response.output.map(item => structuredClone(item) as OpenAiResponseInputItem))
      const calls = response.output.filter((item): item is Extract<OpenAiResponseOutputItem, { type: 'function_call' }> => item.type === 'function_call')
      const messages = response.output.filter((item): item is Extract<OpenAiResponseOutputItem, { type: 'message' }> => item.type === 'message')
      // Models occasionally return a function_call together with a text message (especially when
      // json_schema text format is enabled). Prefer the tool call; ignore extra messages for this turn.
      if (calls.length >= 1) {
        await this.acceptToolCall(state, calls[0]!)
        if (state.run.status === 'waiting-approval') return
        continue
      }
      const finalMessages = messages.filter(message =>
        message.content.some(part => part.type === 'output_text' || part.type === 'refusal')
      )
      try {
        const done = await this.acceptFinal(state, finalMessages.slice(0, 1))
        if (done) return
        continue
      } catch (error) {
        if (
          error instanceof AgentLoopFailure
          && (error.code === 'MODEL_PROTOCOL_INVALID' || error.code === 'MODEL_EVIDENCE_INVALID')
          && state.finalRepairAttempts < 1
        ) {
          state.finalRepairAttempts += 1
          state.input.push({
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Your previous output was invalid: ${error.message}. Return either exactly one function call, or exactly one valid cpppilot.final.v1 JSON object (not both). taskId MUST be exactly "${state.request.requestId}".`
            }]
          })
          continue
        }
        throw error
      }
    }
  }

  private async acceptToolCall(
    state: OpenAiExecutionState,
    item: Extract<OpenAiResponseOutputItem, { type: 'function_call' }>
  ): Promise<void> {
    const maxCalls = Math.min(this.maxToolCalls, state.context!.policy.maxToolCalls)
    if (state.toolCalls >= maxCalls) throw new AgentLoopFailure('TOOL_CALL_LIMIT', `工具调用超过上限 ${maxCalls}。`)
    if (state.evidence.has(item.call_id)) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', `重复的 call_id：${item.call_id}`)
    if (!state.model?.tools.some(tool => tool.name === item.name)) {
      throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', `Function ${item.name} was not advertised for this model turn.`)
    }
    let rawArguments: unknown
    try { rawArguments = JSON.parse(item.arguments) } catch {
      throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', `工具 ${item.name} 的 arguments 不是有效 JSON。`)
    }
    let parsed: ReturnType<OpenAiAgentToolRegistry['parse']>
    try {
      parsed = this.options.registry.parse(item.name, rawArguments, { runId: state.run.id })
    } catch (error) {
      const definition = this.options.registry.resolve(item.name)
      if (!definition) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', error instanceof Error ? error.message : String(error))
      const stepId = `tool-${state.toolCalls + 1}`
      const pending: PendingToolCall = {
        item, definition, arguments: isRecord(rawArguments) ? rawArguments : {}, stepId
      }
      state.toolCalls += 1
      state.run.steps.push({
        id: stepId, sequence: state.run.steps.length, title: definition.title,
        kind: 'tool', status: 'failed', toolName: definition.name
      })
      const output = cppPilotToolOutputSchema.parse({
        protocol: 'cpppilot.tool-output.v1', taskId: state.request.requestId, callId: item.call_id,
        tool: definition.name, ok: false,
        summary: sanitizeModelText(`工具参数校验失败：${error instanceof Error ? error.message : String(error)}`).slice(0, 20_000),
        exitCode: null, diagnostics: [], artifacts: [], changedFiles: [], outcomes: [], retryable: true,
        errorCode: 'TOOL_ARGUMENT_INVALID', durationMs: 0, outputTruncated: false
      })
      await this.recordObservation(state, pending, output, 'failed')
      return
    }
    this.enforceToolPolicy(state, parsed.definition, parsed.arguments)
    const writeBase = this.enforceWriteRevision(state, parsed.definition, parsed.arguments)
    const stepId = `tool-${state.toolCalls + 1}`
    const call: PendingToolCall = { item, ...parsed, stepId }
    state.toolCalls += 1
    state.run.steps.push({
      id: stepId, sequence: state.run.steps.length, title: parsed.definition.title,
      kind: parsed.definition.name.includes('build') || parsed.definition.name.includes('test') ? 'validate' : 'tool',
      status: 'pending', toolName: parsed.definition.name
    })
    await this.persist(state)

    if (shouldRequireApproval(state.context?.policy, parsed.definition.risk, 'tool')) {
      state.pendingCall = call
      const diff = createApprovalDiff(parsed.definition.name, parsed.arguments, writeBase)
      const approval: Approval = {
        id: crypto.randomUUID(), runId: state.run.id, stepId, toolName: parsed.definition.name,
        risk: parsed.definition.risk, title: parsed.definition.title,
        description: `Agent 请求执行 ${parsed.definition.name}。`,
        parameterSummary: summarizeParameters(parsed.arguments),
        ...(diff ? { diff } : {}),
        sideEffects: ['执行本地 MCP 工具'], status: 'pending', createdAt: new Date().toISOString()
      }
      state.run.pendingApproval = approval
      state.run.steps.at(-1)!.status = 'waiting'
      await this.options.store.saveApproval(approval)
      await this.setStatus(state, 'waiting-approval')
      await this.timeline(state, 'approval', 'waiting', '等待工具审批', approval.description, stepId)
      return
    }
    await this.executeTool(state, call)
  }

  private async executeTool(state: OpenAiExecutionState, pending: PendingToolCall): Promise<void> {
    const step = state.run.steps.find(item => item.id === pending.stepId)
    if (!step) throw new AgentLoopFailure('AGENT_STATE_INVALID', '工具步骤不存在。')
    await this.setStatus(state, 'executing')
    step.status = 'running'
    step.startedAt = new Date().toISOString()
    await this.persist(state)
    const startedAt = new Date().toISOString()
    const call: ToolCall = {
      id: crypto.randomUUID(), runId: state.run.id, stepId: pending.stepId,
      serverName: 'cpppilot-local-tools', toolName: pending.definition.name, risk: pending.definition.risk,
      parameterSummary: summarizeParameters(pending.arguments), status: 'running', startedAt
    }
    await this.options.store.saveToolCall(call)
    let result: ToolResult
    try {
      result = await this.withDeadline(state, signal => this.options.toolClient.call(
        pending.definition.name,
        pending.arguments,
        signal,
        progress => this.timeline(state, 'progress', 'running', pending.definition.title, progress.message, pending.stepId)
      ))
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
      if (state.controller.signal.aborted) {
        await this.options.store.saveToolCall({
          ...call, status: 'cancelled', finishedAt, durationMs, errorCode: 'CANCELLED'
        })
        throw error
      }
      if (error instanceof AgentLoopFailure) {
        await this.options.store.saveToolCall({
          ...call, status: 'failed', finishedAt, durationMs, errorCode: error.code
        })
        throw error
      }
      result = {
        ok: false,
        exitCode: null,
        summary: `MCP transport failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 20_000),
        diagnostics: [],
        artifacts: [],
        sideEffects: [],
        retryable: true,
        errorCode: 'MCP_CALL_FAILED',
        durationMs
      }
    }
    const finishedAt = new Date().toISOString()
    await this.options.store.saveToolCall({
      ...call, result, status: result.ok ? 'completed' : 'failed', finishedAt,
      durationMs: result.durationMs, ...(result.errorCode ? { errorCode: result.errorCode } : {})
    })
    this.captureCapabilities(state, pending, result)
    this.captureFileRead(state, pending, result)
    const output = toolOutputFor(state, pending, result)
    await this.recordObservation(state, pending, output, result.ok ? 'completed' : 'failed')
  }

  private async recordObservation(
    state: OpenAiExecutionState,
    pending: PendingToolCall,
    output: CppPilotToolOutput,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    let repeatedFailure = false
    if (!output.ok) {
      const signature = failedCallSignature(pending, output)
      repeatedFailure = state.failedCallSignatures.has(signature)
      state.failedCallSignatures.add(signature)
    }
    state.evidence.set(pending.item.call_id, output)
    state.input.push({ type: 'function_call_output', call_id: pending.item.call_id, output: JSON.stringify(output) })
    const step = state.run.steps.find(item => item.id === pending.stepId)
    if (step) {
      step.status = status
      step.summary = output.summary
      step.finishedAt = new Date().toISOString()
    }
    await this.persist(state)
    await this.timeline(
      state, 'tool', status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed',
      pending.definition.title, output.summary, pending.stepId,
      { callId: pending.item.call_id, toolName: pending.definition.name, exitCode: output.exitCode }
    )
    if (repeatedFailure) {
      throw new AgentLoopFailure(
        'AGENT_LOOP_DETECTED',
        `The model repeated the same failed ${pending.definition.name} call without changing its arguments or resolving the error.`
      )
    }
  }

  private rejectedToolOutput(state: OpenAiExecutionState, call: PendingToolCall, reason?: string): CppPilotToolOutput {
    return cppPilotToolOutputSchema.parse({
      protocol: 'cpppilot.tool-output.v1', taskId: state.request.requestId, callId: call.item.call_id,
      tool: call.definition.name, ok: false,
      summary: sanitizeModelText(reason ? `用户拒绝工具调用：${reason}` : '用户拒绝工具调用。'),
      exitCode: null, diagnostics: [], artifacts: [], changedFiles: [], outcomes: [], retryable: false,
      errorCode: 'TOOL_REJECTED', durationMs: 0, outputTruncated: false
    })
  }

  private async acceptFinal(
    state: OpenAiExecutionState,
    messages: Array<Extract<OpenAiResponseOutputItem, { type: 'message' }>>
  ): Promise<boolean> {
    if (messages.length !== 1) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型未返回工具调用或最终响应。')
    const refusals = messages[0]!.content.filter(item => item.type === 'refusal')
    if (refusals.length) throw new AgentLoopFailure('MODEL_REFUSED', refusals.map(item => item.refusal).join('\n'))
    const texts = messages[0]!.content.filter(item => item.type === 'output_text')
    if (texts.length !== 1) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型最终响应必须包含一个 output_text。')
    let raw: unknown
    try { raw = JSON.parse(texts[0]!.text) } catch {
      throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型最终响应不是有效 JSON。')
    }
    // Models often invent taskId. Coerce to the authoritative request id when the rest is valid.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const candidate = raw as Record<string, unknown>
      if (candidate.protocol === 'cpppilot.final.v1') candidate.taskId = state.request.requestId
    }
    const parsed = cppPilotFinalResponseSchema.safeParse(raw)
    if (!parsed.success) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', parsed.error.issues.map(issue => issue.message).join('；'))
        let final = this.enrichFinalFromEvidence(state, parsed.data)

    // Model must actually call tools for write/build/create work. Reject "I am writing main.cpp" finals.
    if (
      final.status !== 'needs_input'
      && !hasSuccessfulEvidence(state)
      && claimsToolActionWithoutEvidence(final)
      && state.finalRepairAttempts < 2
    ) {
      state.finalRepairAttempts += 1
      state.input.push({
        role: 'user',
        content: [{
          type: 'input_text',
          text: [
            'You returned a final response that claims file/code work without successful tool evidence in this run.',
            'Do NOT narrate tool use. Call the real functions now (read current file hash if needed, then workspace_apply_patch / workspace_create_file, then compiler_build / program_run when appropriate).',
            'After tools succeed, return one completed cpppilot.final.v1 using only local outcomes in claims.',
            `taskId MUST be exactly "${state.request.requestId}".`
          ].join(' ')
        }]
      })
      return false
    }

    // Mid-task "failed" messages are often premature; if tools already succeeded, keep going via repair once.
    if (
      final.status === 'failed'
      && state.finalRepairAttempts < 2
      && looksLikePrematureFailure(final.messageMarkdown)
      && hasSuccessfulEvidence(state)
    ) {
      state.finalRepairAttempts += 1
      state.input.push({
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Do not mark the task failed while tools can still finish it. Successful tool evidence already exists in this run. Continue with any remaining function calls (build/run if needed), then return one completed cpppilot.final.v1 with claims taken only from tool outcomes. taskId MUST be "${state.request.requestId}".`
        }]
      })
      return false
    }
    this.validateEvidence(state, final)
    state.run.intent = final.intent.primary
    state.run.response = final.messageMarkdown

    if (final.status === 'needs_input') {
      state.run.pendingClarification = { question: final.clarificationQuestion!, requestedAt: new Date().toISOString() }
      await this.setStatus(state, 'waiting-input')
      await this.timeline(state, 'response', 'waiting', '等待用户补充信息', final.clarificationQuestion!)
      return true
    }
    if (final.status === 'failed') {
      state.run.errorCode = 'MODEL_REPORTED_FAILURE'
      state.run.errorMessage = final.messageMarkdown
      await this.setStatus(state, 'failed')
      state.run.completedAt = state.run.updatedAt
      await this.persist(state)
      await this.timeline(state, 'response', 'failed', '模型报告任务失败', final.messageMarkdown)
      this.executions.delete(state.run.id)
      return true
    }
    await this.setStatus(state, 'completed')
    state.run.completedAt = state.run.updatedAt
    state.run.validationSummary = evidenceSummary(final, state.evidence)
    await this.persist(state)
    await this.timeline(state, 'response', 'completed', '完成回答', final.messageMarkdown)
    this.executions.delete(state.run.id)
  return true
  }

  private validateEvidence(state: OpenAiExecutionState, final: CppPilotFinalResponse): void {
    for (const callId of final.evidenceCallIds) {
      const evidence = state.evidence.get(callId)
      if (!evidence || (final.status === 'completed' && !evidence.ok)) {
        throw new AgentLoopFailure('MODEL_EVIDENCE_INVALID', `最终响应引用了不存在或不适用于完成状态的证据：${callId}`)
      }
    }
    for (const claim of final.claims) {
      const evidence = state.evidence.get(claim.callId)
      const matched = evidence?.outcomes.some(outcome => outcome.type === claim.type && outcome.target === claim.target)
      if (!matched) {
        throw new AgentLoopFailure(
          'MODEL_EVIDENCE_INVALID',
          `最终声明 ${claim.type} 未由调用 ${claim.callId} 的本地结构化结果证明。`
        )
      }
    }
    if (final.status !== 'completed') return
    const required = requiredClaimsFor(final.intent.primary, state)
    for (const claimType of required) {
      if (!final.claims.some(claim => claim.type === claimType)) {
        throw new AgentLoopFailure('MODEL_EVIDENCE_INVALID', `完成状态缺少本地结构化声明：${claimType}`)
      }
    }
  }

  private enrichFinalFromEvidence(state: OpenAiExecutionState, final: CppPilotFinalResponse): CppPilotFinalResponse {
    if (final.status !== 'completed' && final.status !== 'failed') return final
    const claims = [...final.claims]
    const evidenceCallIds = new Set(final.evidenceCallIds)
    for (const [callId, evidence] of state.evidence) {
      if (!evidence.ok) continue
      evidenceCallIds.add(callId)
      for (const outcome of evidence.outcomes) {
        const exists = claims.some(claim =>
          claim.type === outcome.type
          && claim.callId === callId
          && claim.target === outcome.target
        )
        if (!exists) claims.push({ type: outcome.type, callId, target: outcome.target })
      }
    }
    return {
      ...final,
      evidenceCallIds: [...evidenceCallIds].slice(0, 100),
      claims: claims.slice(0, 100)
    }
  }

  private enforceToolPolicy(
    state: OpenAiExecutionState,
    definition: AgentToolDefinition,
    args: Record<string, unknown>
  ): void {
    const argumentProjectId = typeof args.projectId === 'string'
      ? args.projectId
      : state.context?.policy.allowedProjectId ?? state.request.projectId
    const mayCreateNewPath = state.context?.policy.allowNewPaths === true
      && definition.name.replace(/[^A-Za-z0-9]+/g, '_') === 'workspace_create_file'
    const pending: unknown[] = [args]

    while (pending.length > 0) {
      const value = pending.pop()
      if (Array.isArray(value)) {
        pending.push(...value)
        continue
      }
      if (!isRecord(value)) continue

      for (const [key, nested] of Object.entries(value)) {
        if (key === 'projectId') {
          if (typeof nested !== 'string' || !state.grantedProjectIds.has(nested)) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool projectId is outside the current task.')
          }
          continue
        }
        if (key === 'workspaceId') {
          if (typeof nested !== 'string' || nested !== state.context?.policy.allowedWorkspaceId) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool workspaceId is outside the current task.')
          }
          continue
        }
        if (key === 'runId') {
          if (typeof nested !== 'string' || nested !== state.run.id) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool runId does not belong to the current task.')
          }
          continue
        }
        if (key === 'relativePath' || key === 'path') {
          if (typeof nested !== 'string' || !isRelativePath(nested)) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool path must stay inside the current project.')
          }
          if (
            (!argumentProjectId || !state.grantedPaths.has(fileReadKey(argumentProjectId, nested)))
            && !mayCreateNewPath
          ) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool path is not allowed for the current task.')
          }
          continue
        }
        if (key === 'buildId') {
          if (typeof nested !== 'string' || !state.grantedBuildIds.has(nested)) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool buildId was not produced by the current task.')
          }
          continue
        }
        if (key === 'sessionId') {
          if (typeof nested !== 'string' || !state.grantedSessionIds.has(nested)) {
            throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'Tool sessionId was not produced by the current task.')
          }
          continue
        }
        pending.push(nested)
      }
    }
  }

  private enforceWriteRevision(
    state: OpenAiExecutionState,
    definition: AgentToolDefinition,
    args: Record<string, unknown>
  ): { path: string; content: string } | undefined {
    if (definition.name.replace(/[^A-Za-z0-9]+/g, '_') !== 'workspace_apply_patch') return undefined
    if (
      typeof args.projectId !== 'string'
      || typeof args.relativePath !== 'string'
      || typeof args.expectedHash !== 'string'
    ) {
      throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'A whole-file write requires projectId, relativePath, and expectedHash.')
    }
    const relativePath = normalizeRelativePath(args.relativePath)
    const read = state.fileReads.get(fileReadKey(args.projectId, relativePath))
    if (read && read.contentHash === args.expectedHash) {
      if (!read.modelContentComplete) {
        throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'A whole-file write cannot use a truncated file read as its base.')
      }
      return { path: relativePath, content: read.content }
    }
    const active = state.context?.workspace.activeFile
    if (
      active
      && state.context?.policy.allowedProjectId === args.projectId
      && normalizeRelativePath(active.path) === relativePath
      && active.contentHash === args.expectedHash
    ) {
      if (active.truncated || active.redacted) {
        throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', 'A whole-file write cannot use truncated initial context as its base.')
      }
      return { path: relativePath, content: active.content }
    }
    throw new AgentLoopFailure(
      'TOOL_POLICY_VIOLATION',
      'A whole-file write must use an expectedHash from a complete current-run read or complete initial active file.'
    )
  }

  private captureFileRead(state: OpenAiExecutionState, pending: PendingToolCall, result: ToolResult): void {
    if (!result.ok || pending.definition.name.replace(/[^A-Za-z0-9]+/g, '_') !== 'workspace_read_file') return
    if (!isRecord(result.structuredContent)) return
    const { projectId, relativePath, content, contentHash } = result.structuredContent
    if (
      typeof projectId !== 'string'
      || typeof relativePath !== 'string'
      || typeof content !== 'string'
      || typeof contentHash !== 'string'
      || projectId !== pending.arguments.projectId
      || normalizeRelativePath(relativePath) !== normalizeRelativePath(String(pending.arguments.relativePath))
    ) return
    const normalizedPath = normalizeRelativePath(relativePath)
    const modelView = sanitizeToolData({ content })
    const modelContentComplete = modelView.truncated === false && modelView.data.content === content
    state.fileReads.set(fileReadKey(projectId, normalizedPath), {
      projectId,
      relativePath: normalizedPath,
      content: modelContentComplete ? content : '',
      contentHash,
      modelContentComplete
    })
  }

  private grantInitialCapabilities(state: OpenAiExecutionState): void {
    const projectId = state.context?.policy.allowedProjectId ?? state.request.projectId
    if (!projectId) return
    state.grantedProjectIds.add(projectId)
    for (const path of state.context?.policy.allowedPaths ?? []) {
      state.grantedPaths.add(fileReadKey(projectId, path))
    }
  }

  private captureCapabilities(state: OpenAiExecutionState, pending: PendingToolCall, result: ToolResult): void {
    if (!result.ok) return
    const alias = pending.definition.name.replace(/[^A-Za-z0-9]+/g, '_')
    const data = isRecord(result.structuredContent) ? result.structuredContent : undefined

    if (alias === 'project_create' && typeof data?.projectId === 'string') {
      state.grantedProjectIds.add(data.projectId)
      if (typeof data.relativePath === 'string' && isRelativePath(data.relativePath)) {
        state.grantedPaths.add(fileReadKey(data.projectId, data.relativePath))
      }
    }
    const argumentProjectId = typeof pending.arguments.projectId === 'string' ? pending.arguments.projectId : undefined
    if (argumentProjectId) {
      const changedFiles = result.sideEffects
        .filter(effect => ['write-file', 'create-file'].includes(effect.kind) && isRelativePath(effect.target))
        .map(effect => effect.target)
      if (alias === 'workspace_create_file' && typeof pending.arguments.relativePath === 'string') {
        changedFiles.push(pending.arguments.relativePath)
      }
      for (const path of changedFiles) state.grantedPaths.add(fileReadKey(argumentProjectId, path))
    }
    if (typeof data?.buildId === 'string') state.grantedBuildIds.add(data.buildId)
    if (alias === 'debug_start' && typeof data?.sessionId === 'string') state.grantedSessionIds.add(data.sessionId)
  }

  private validateRestoredPendingCall(
    state: OpenAiExecutionState,
    stored: { item: Extract<OpenAiResponseOutputItem, { type: 'function_call' }>; arguments: Record<string, unknown>; stepId: string }
  ): PendingToolCall {
    if (stored.item.status !== undefined && stored.item.status !== 'completed') throw new Error('Pending call is not complete')
    const raw = JSON.parse(stored.item.arguments) as unknown
    const parsed = this.options.registry.parse(stored.item.name, raw, { runId: state.run.id })
    if (stableJson(parsed.arguments) !== stableJson(stored.arguments)) throw new Error('Pending arguments were modified')
    const approval = state.run.pendingApproval
    if (
      !approval
      || approval.stepId !== stored.stepId
      || approval.toolName !== parsed.definition.name
      || approval.risk !== parsed.definition.risk
      || approval.title !== parsed.definition.title
      || stableJson(approval.parameterSummary) !== stableJson(summarizeParameters(parsed.arguments))
    ) throw new Error('Pending approval does not match the call')
    if ('buildId' in parsed.arguments || 'sessionId' in parsed.arguments) {
      throw new Error('Pending call depends on an ephemeral backend capability')
    }
    this.enforceToolPolicy(state, parsed.definition, parsed.arguments)
    const writeBase = this.enforceWriteRevision(state, parsed.definition, parsed.arguments)
    const expectedDiff = createApprovalDiff(parsed.definition.name, parsed.arguments, writeBase)
    if ((approval.diff ?? null) !== (expectedDiff ?? null)) throw new Error('Pending approval diff does not match the call')
    return { item: stored.item, definition: parsed.definition, arguments: parsed.arguments, stepId: stored.stepId }
  }

  private async guard(state: OpenAiExecutionState, operation: () => Promise<void>): Promise<void> {
    if (state.controller.signal.aborted || isTerminal(state.run.status)) return
    try {
      await operation()
    } catch (error) {
      if (state.controller.signal.aborted || isTerminal(state.run.status)) return
      if (error instanceof OpenAiResponsesError) await this.fail(state, error.code, error.message)
      else if (error instanceof AgentLoopFailure) await this.fail(state, error.code, error.message)
      else await this.fail(state, 'AGENT_RUNTIME_ERROR', error instanceof Error ? error.message : String(error))
    }
  }

  private async fail(state: OpenAiExecutionState, code: string, message: string): Promise<void> {
    state.run.pendingApproval = undefined
    state.run.pendingClarification = undefined
    state.run.errorCode = code
    state.run.errorMessage = message
    state.run.response = `任务未完成：${message}`
    await this.setStatus(state, 'failed')
    state.run.completedAt = state.run.updatedAt
    await this.persist(state)
    await this.timeline(state, 'error', 'failed', '任务失败', message, undefined, { errorCode: code })
    this.executions.delete(state.run.id)
  }

  private checkDeadline(state: OpenAiExecutionState): void {
    if (this.currentRemainingTime(state) <= 0) throw new AgentLoopFailure('AGENT_TIMEOUT', 'Agent 任务超过总时限。')
  }

  private checkSessionBudget(state: OpenAiExecutionState): void {
    if (state.input.length > this.maxSessionItems) {
      throw new AgentLoopFailure(
        'SESSION_ITEM_LIMIT',
        `Agent model session contains ${state.input.length} items, exceeding the limit ${this.maxSessionItems}.`
      )
    }
    const bytes = new TextEncoder().encode(JSON.stringify(state.input)).byteLength
    if (bytes > this.maxSessionBytes) {
      throw new AgentLoopFailure(
        'SESSION_BYTE_LIMIT',
        `Agent model session contains ${bytes} UTF-8 bytes, exceeding the limit ${this.maxSessionBytes}.`
      )
    }
  }

  private async withDeadline<T>(
    state: OpenAiExecutionState,
    operation: (signal: AbortSignal) => Promise<T>,
    operationLimit?: { timeoutMs: number; code: string; message: string }
  ): Promise<T> {
    if (state.controller.signal.aborted) throw state.controller.signal.reason
    this.checkDeadline(state)
    const remaining = this.currentRemainingTime(state)
    const operationIsLimiter = operationLimit !== undefined && operationLimit.timeoutMs <= remaining
    const timeoutMs = Math.max(1, Math.min(remaining, operationLimit?.timeoutMs ?? remaining))
    const timeoutError = operationIsLimiter
      ? new AgentLoopFailure(operationLimit.code, operationLimit.message)
      : new AgentLoopFailure('AGENT_TIMEOUT', 'Agent 任务超过总时限。')
    const timeout = new AbortController()
    const signal = AbortSignal.any([state.controller.signal, timeout.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    let removeAbortListener: (() => void) | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timeout.abort(timeoutError)
        reject(timeoutError)
      }, timeoutMs)
    })
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(state.controller.signal.reason)
      if (state.controller.signal.aborted) onAbort()
      else {
        state.controller.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => state.controller.signal.removeEventListener('abort', onAbort)
      }
    })
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw signal.reason
          return operation(signal)
        }),
        timeoutPromise,
        cancellationPromise
      ])
    } finally {
      if (timer) clearTimeout(timer)
      removeAbortListener?.()
    }
  }

  private async setStatus(state: OpenAiExecutionState, status: AgentRun['status']): Promise<void> {
    if (state.controller.signal.aborted && status !== 'cancelled') throw state.controller.signal.reason
    if (isWaitingStatus(status)) this.pauseBudget(state)
    else if (!isTerminal(status)) this.resumeBudget(state)
    state.run.status = status
    state.run.updatedAt = new Date().toISOString()
    await this.persist(state)
  }

  private async persist(state: OpenAiExecutionState): Promise<void> {
    const session = isTerminal(state.run.status) ? undefined : this.sessionFor(state)
    await this.options.store.saveCheckpoint(state.run, session)
    this.publish(state.run)
  }

  private async ensureModel(state: OpenAiExecutionState): Promise<void> {
    if (state.model) return
    const model = await this.withDeadline(state, signal => this.options.modelFactory.create(signal))
    if (!model) throw new AgentLoopFailure('MODEL_NOT_CONFIGURED', '未配置可用的 OpenAI Responses 模型或 API Key。')
    if (state.modelProfileId && model.profile.id !== state.modelProfileId) {
      throw new AgentLoopFailure('MODEL_PROFILE_CHANGED', '等待期间模型配置已更改，无法安全恢复原会话。')
    }
    if (state.modelContract && modelContractFor(model) !== state.modelContract) {
      throw new AgentLoopFailure('MODEL_PROFILE_CHANGED', '等待期间模型 endpoint、model、tools 或 instructions 已更改，无法安全恢复原会话。')
    }
    state.model = model
    state.modelProfileId = model.profile.id
    state.modelContract = modelContractFor(model)
  }

  private sessionFor(state: OpenAiExecutionState): RuntimeSessionRecord | undefined {
    if (!state.context || !state.modelProfileId || !state.modelContract) return undefined
    return {
      runId: state.run.id,
      protocol: 'cpppilot.openai-session.v1',
      state: {
        request: state.request,
        context: state.context,
        input: state.input,
        modelProfileId: state.modelProfileId,
        modelContract: state.modelContract,
        modelTurns: state.modelTurns,
        toolCalls: state.toolCalls,
        evidence: [...state.evidence.entries()],
        failedCallSignatures: [...state.failedCallSignatures],
        fileReads: [...state.fileReads.entries()],
        grantedProjectIds: [...state.grantedProjectIds],
        grantedPaths: [...state.grantedPaths],
        grantedBuildIds: [...state.grantedBuildIds],
        grantedSessionIds: [...state.grantedSessionIds],
        finalRepairAttempts: state.finalRepairAttempts,
        ...(state.pendingCall ? {
          pendingCall: {
            item: state.pendingCall.item,
            arguments: state.pendingCall.arguments,
            stepId: state.pendingCall.stepId
          }
        } : {}),
        remoteContextApproved: state.remoteContextApproved,
        remainingTimeMs: Math.max(0, Math.min(300_000, this.currentRemainingTime(state)))
      },
      updatedAt: new Date().toISOString()
    }
  }

  private currentRemainingTime(state: OpenAiExecutionState): number {
    const elapsed = state.activeSince === undefined ? 0 : Math.max(0, Date.now() - state.activeSince)
    return Math.max(0, state.remainingTimeMs - elapsed)
  }

  private chargeActiveBudget(state: OpenAiExecutionState): void {
    state.remainingTimeMs = this.currentRemainingTime(state)
    delete state.activeSince
  }

  private pauseBudget(state: OpenAiExecutionState): void {
    if (state.activeSince !== undefined) this.chargeActiveBudget(state)
  }

  private resumeBudget(state: OpenAiExecutionState): void {
    if (state.activeSince === undefined) state.activeSince = Date.now()
  }

  private claimAction(key: string): () => void {
    if (this.activeActions.has(key)) throw new Error('Agent action is already in progress')
    this.activeActions.add(key)
    return () => this.activeActions.delete(key)
  }

  private async timeline(
    state: OpenAiExecutionState,
    kind: TimelineEvent['kind'],
    status: TimelineEvent['status'],
    title: string,
    summary: string,
    stepId?: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const event: TimelineEvent = {
      id: crypto.randomUUID(), runId: state.run.id,
      sequence: this.options.store.get(state.run.id)?.timeline.length ?? 0,
      kind, status, title, summary: summary.slice(0, 20_000), occurredAt: new Date().toISOString(),
      ...(stepId ? { stepId } : {}), ...(data ? { data } : {})
    }
    await this.options.store.append(event)
    this.publish(state.run)
  }

  private publish(run: AgentRun): void {
    for (const listener of this.listeners) listener(structuredClone(run))
  }
}


function hasSuccessfulEvidence(state: OpenAiExecutionState): boolean {
  for (const evidence of state.evidence.values()) {
    if (evidence.ok && evidence.outcomes.length) return true
  }
  return false
}


function claimsToolActionWithoutEvidence(final: CppPilotFinalResponse): boolean {
  if (final.status === 'needs_input') return false
  const actionIntents = new Set(['edit_code', 'create_project', 'environment_setup'])
  if (actionIntents.has(final.intent.primary)) return true
  const text = final.messageMarkdown
  const markers = [
    'apply_patch',
    'writeFile',
    'compiler.build',
    'program.run',
    '写入',
    '正在生成',
    '生成经典',
    '创建文件',
    '修改了',
    '已写入',
    '编译并运行',
    '正在编译',
    '正在运行'
  ]
  return markers.some(marker => text.includes(marker))
}

function looksLikePrematureFailure(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('请再发')
    || text.includes('本轮还没有')
    || text.includes('正在编译')
    || text.includes('正在运行')
    || text.includes('会继续')
    || text.includes('not finished')
    || text.includes('still need')
    || text.includes('please send')
  )
}

function requiredClaimsFor(
  intent: CppPilotFinalResponse['intent']['primary'],
  state: OpenAiExecutionState
): CppPilotToolOutcome['type'][] {
  const outcomes = [...state.evidence.values()].flatMap(item => item.ok ? item.outcomes : [])
  const has = (type: CppPilotToolOutcome['type']) => outcomes.some(item => item.type === type)
  if (intent === 'edit_code') {
    const required: CppPilotToolOutcome['type'][] = []
    if (has('file_changed')) required.push('file_changed')
    // Only require build when a successful build outcome exists or a build was attempted and claimed needed
    if (has('build_succeeded')) required.push('build_succeeded')
    // If model claims edit_code but nothing succeeded, still require a file change to avoid empty "completed"
    if (!required.length) required.push('file_changed')
    return required
  }
  if (intent === 'create_project') {
    const required: CppPilotToolOutcome['type'][] = []
    if (has('project_created') || true) required.push('project_created')
    if (has('build_succeeded')) required.push('build_succeeded')
    return required
  }
  if (intent === 'environment_setup') return ['environment_configured']
  return []
}

function toolOutputFor(state: OpenAiExecutionState, pending: PendingToolCall, result: ToolResult): CppPilotToolOutput {
  const changedFiles = result.sideEffects
    .filter(item => ['write-file', 'create-file', 'delete-file'].includes(item.kind) && isRelativePath(item.target))
    .map(item => normalizeRelativePath(item.target)).slice(0, 100)
  const sanitizedData = isRecord(result.structuredContent) ? sanitizeToolData(result.structuredContent) : undefined
  return cppPilotToolOutputSchema.parse({
    protocol: 'cpppilot.tool-output.v1', taskId: state.request.requestId, callId: pending.item.call_id,
    tool: pending.definition.name, ok: result.ok, summary: sanitizeModelText(result.summary).slice(0, 20_000), exitCode: result.exitCode,
    diagnostics: result.diagnostics.slice(0, 200).map(item => ({
      source: item.source, severity: item.severity, ...(item.code ? { code: item.code } : {}),
      ...(item.file && isRelativePath(item.file) ? { file: item.file } : {}),
      ...(item.line ? { line: item.line } : {}), ...(item.column ? { column: item.column } : {}),
      message: sanitizeModelText(item.normalizedMessage || item.rawMessage).slice(0, 20_000)
    })),
    artifacts: result.artifacts.slice(0, 100).map(item => ({
      id: sanitizeModelText(item.id), kind: item.kind, label: sanitizeModelText(item.label)
    })),
    changedFiles,
    outcomes: toolOutcomesFor(pending, result, changedFiles),
    ...(sanitizedData ? { data: sanitizedData.data } : {}),
    retryable: result.retryable, ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    durationMs: result.durationMs,
    outputTruncated: result.diagnostics.length > 200 || result.artifacts.length > 100 || sanitizedData?.truncated === true
  })
}

function toolOutcomesFor(
  pending: PendingToolCall,
  result: ToolResult,
  changedFiles: string[]
): CppPilotToolOutcome[] {
  if (!result.ok) return []
  const outcomes: CppPilotToolOutcome[] = changedFiles.map(target => ({ type: 'file_changed', target }))
  const alias = pending.definition.name.replace(/[^A-Za-z0-9]+/g, '_')
  const relativePath = typeof pending.arguments.relativePath === 'string' && isRelativePath(pending.arguments.relativePath)
    ? normalizeRelativePath(pending.arguments.relativePath)
    : null
  const add = (type: CppPilotToolOutcome['type'], target: string | null = relativePath) => {
    if (!outcomes.some(outcome => outcome.type === type && outcome.target === target)) outcomes.push({ type, target })
  }

  if (alias === 'workspace_read_file') add('file_read')
  if ((alias === 'workspace_apply_patch' || alias === 'workspace_create_file' || alias === 'workspace_write_file') && relativePath) {
    add('file_changed', relativePath)
  }
  if ((alias === 'compiler_build' || alias === 'cmake_build') && result.exitCode === 0) add('build_succeeded')
  if ((alias === 'tests_run_cases' || alias === 'ctest_run') && result.exitCode === 0) add('tests_succeeded')
  if (alias === 'program_run' && result.exitCode === 0) add('program_succeeded')
  if (alias === 'analysis_clang_tidy' && result.exitCode === 0) add('analysis_succeeded')
  if (alias === 'debug_start' || alias === 'debug_command') add('debug_succeeded')
  if (alias === 'project_create') {
    const target = isRecord(result.structuredContent) && typeof result.structuredContent.projectId === 'string'
      ? result.structuredContent.projectId
      : null
    add('project_created', target)
  }
  if (alias === 'toolchain_bind_compiler') add('environment_configured', null)
  return outcomes.slice(0, 100)
}

function summarizeParameters(value: Record<string, unknown>): Record<string, unknown> {
  const summarize = (item: unknown, depth: number): unknown => {
    if (depth > 4) return '[nested]'
    if (typeof item === 'string') return item.length > 500 ? `${item.slice(0, 500)}... (${item.length} chars)` : item
    if (Array.isArray(item)) return item.slice(0, 20).map(entry => summarize(entry, depth + 1))
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).slice(0, 50).map(([key, entry]) => [key, summarize(entry, depth + 1)]))
    }
    return item
  }
  return summarize(value, 0) as Record<string, unknown>
}

function contextSummary(context: CppPilotContextEnvelope): string {
  const file = context.task.activeFile ? `，活动文件 ${context.task.activeFile}` : ''
  return `已封装原始请求（${context.task.prompt.length} 字符）${file}，关联 ${context.workspace.relatedFiles.length} 个文件。`
}

function evidenceSummary(final: CppPilotFinalResponse, evidence: Map<string, CppPilotToolOutput>): string {
  if (!final.evidenceCallIds.length) return '无需工具操作。'
  return final.evidenceCallIds.map(callId => evidence.get(callId)?.summary ?? callId).join('；').slice(0, 20_000)
}

function isTerminal(status: AgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isRestorableStatus(status: AgentRun['status']): boolean {
  return status === 'waiting-model-approval' || status === 'waiting-approval' || status === 'waiting-input'
}

function isWaitingStatus(status: AgentRun['status']): boolean {
  return status === 'waiting-model-approval' || status === 'waiting-approval' || status === 'waiting-input'
}

function isRelativePath(value: string): boolean {
  const normalized = normalizeRelativePath(value)
  return !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized) && !normalized.split('/').includes('..')
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function failedCallSignature(pending: PendingToolCall, output: CppPilotToolOutput): string {
  return stableJson({
    tool: pending.definition.name,
    arguments: pending.arguments,
    error: {
      errorCode: output.errorCode ?? null,
      exitCode: output.exitCode,
      summary: output.summary,
      diagnostics: output.diagnostics
    }
  })
}

function modelContractFor(model: OpenAiAgentModel): string {
  return stableJson({
    protocol: 'cpppilot.model-contract.v1',
    profile: { id: model.profile.id, baseUrl: model.profile.baseUrl, model: model.profile.model },
    tools: model.tools,
    instructions: CPPPILOT_OPENAI_INSTRUCTIONS
  })
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (!isRecord(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
  }
  return JSON.stringify(normalize(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeToolData(value: Record<string, unknown>): { data: Record<string, unknown>; truncated: boolean } {
  let truncated = false
  const sanitize = (item: unknown, key: string, depth: number): unknown => {
    if (depth > 6) {
      truncated = true
      return '[truncated]'
    }
    if (typeof item === 'string') {
      if (/secret|token|api.?key|authorization/i.test(key)) return '[redacted]'
      if (/path|root|directory|executable/i.test(key) && !isRelativePath(item)) return '[local path redacted]'
      const sanitized = sanitizeModelText(item)
      if (sanitized.length > 100_000) {
        truncated = true
        return `${sanitized.slice(0, 100_000)}...`
      }
      return sanitized
    }
    if (Array.isArray(item)) {
      if (item.length > 200) truncated = true
      return item.slice(0, 200).map(entry => sanitize(entry, key, depth + 1))
    }
    if (isRecord(item)) {
      const entries = Object.entries(item)
      if (entries.length > 200) truncated = true
      return Object.fromEntries(entries.slice(0, 200).map(([nestedKey, nested]) => [
        nestedKey,
        sanitize(nested, nestedKey, depth + 1)
      ]))
    }
    return item
  }
  return { data: sanitize(value, '', 0) as Record<string, unknown>, truncated }
}

function sanitizeModelText(value: string): string {
  return sanitizeModelVisibleText(value).text
}

function createApprovalDiff(
  toolName: string,
  args: Record<string, unknown>,
  base?: { path: string; content: string }
): string | undefined {
  if (
    toolName.replace(/[^A-Za-z0-9]+/g, '_') !== 'workspace_apply_patch'
    || typeof args.content !== 'string'
    || typeof args.relativePath !== 'string'
  ) return undefined
  if (!base || base.path !== normalizeRelativePath(args.relativePath) || base.content === args.content) return undefined
  return lineDiff(base.content, args.content, args.relativePath).slice(0, 100_000)
}

function fileReadKey(projectId: string, relativePath: string): string {
  return `${projectId}:${normalizeRelativePath(relativePath)}`
}

function lineDiff(current: string, proposed: string, relativePath: string): string {
  const before = current.replaceAll('\r\n', '\n').split('\n')
  const after = proposed.replaceAll('\r\n', '\n').split('\n')
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1
  const contextStart = Math.max(0, prefix - 2)
  const beforeChangeEnd = before.length - suffix
  const afterChangeEnd = after.length - suffix
  const beforeEnd = Math.min(before.length, beforeChangeEnd + 2)
  const afterEnd = Math.min(after.length, afterChangeEnd + 2)
  const lines = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${contextStart + 1},${beforeEnd - contextStart} +${contextStart + 1},${afterEnd - contextStart} @@`
  ]
  for (let index = contextStart; index < prefix; index += 1) lines.push(` ${before[index] ?? ''}`)
  for (let index = prefix; index < beforeChangeEnd; index += 1) lines.push(`-${before[index] ?? ''}`)
  for (let index = prefix; index < afterChangeEnd; index += 1) lines.push(`+${after[index] ?? ''}`)
  for (let index = 0; index < Math.min(2, suffix); index += 1) lines.push(` ${before[beforeChangeEnd + index] ?? ''}`)
  return lines.join('\n')
}
