import {
  agentContinueRequestSchema,
  agentStartRequestSchema,
  cppPilotContextEnvelopeSchema,
  cppPilotFinalResponseSchema,
  cppPilotToolOutputSchema,
  type AgentContinueRequest,
  type AgentRun,
  type AgentRunDetail,
  type AgentStartRequest,
  type Approval,
  type ApprovalDecision,
  type CppPilotContextEnvelope,
  type CppPilotFinalResponse,
  type CppPilotToolOutput,
  type ModelProfile,
  type OpenAiFunctionTool,
  type OpenAiResponseOutputItem,
  type TimelineEvent,
  type ToolCall,
  type ToolResult,
  type ToolRisk
} from '@cpp-pet/contracts'
import type {
  AgentRuntimeController,
  ResolvedAgentRequest,
  RuntimeStore,
  RuntimeToolClient
} from './runtime'
import type { OpenAiResponseInputItem, OpenAiResponsesResult } from './responses-client'
import { OpenAiResponsesError } from './responses-client'

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
  parse(functionName: string, args: unknown): {
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
}

interface PendingToolCall {
  item: Extract<OpenAiResponseOutputItem, { type: 'function_call' }>
  definition: AgentToolDefinition
  arguments: Record<string, unknown>
  stepId: string
}

interface OpenAiExecutionState {
  request: ResolvedAgentRequest
  run: AgentRun
  controller: AbortController
  deadline: number
  model?: OpenAiAgentModel
  context?: CppPilotContextEnvelope
  input: OpenAiResponseInputItem[]
  modelTurns: number
  toolCalls: number
  evidence: Map<string, CppPilotToolOutput>
  finalRepairAttempts: number
  pendingCall?: PendingToolCall
  remoteContextApproved: boolean
}

class AgentLoopFailure extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AgentLoopFailure'
  }
}

export class OpenAiAgentRuntime implements AgentRuntimeController {
  private readonly executions = new Map<string, OpenAiExecutionState>()
  private readonly listeners = new Set<(run: AgentRun) => void>()
  private readonly totalTimeoutMs: number
  private readonly maxModelTurns: number
  private readonly maxToolCalls: number

  constructor(private readonly options: OpenAiAgentRuntimeOptions) {
    this.totalTimeoutMs = options.totalTimeoutMs ?? 120_000
    this.maxModelTurns = options.maxModelTurns ?? 12
    this.maxToolCalls = options.maxToolCalls ?? 20
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
      request, run, controller: new AbortController(), deadline: Date.now() + this.totalTimeoutMs,
      input: [], modelTurns: 0, toolCalls: 0, evidence: new Map(), finalRepairAttempts: 0, remoteContextApproved: false
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
      state.context = cppPilotContextEnvelopeSchema.parse(
        await this.withDeadline(state, signal => this.options.contextBuilder.build(request, request.requestId, 0, signal))
      )
      if (state.context.taskId !== request.requestId) {
        throw new AgentLoopFailure('CONTEXT_PROTOCOL_INVALID', '上下文 taskId 与请求不一致。')
      }
      await this.timeline(state, 'context', 'completed', '构建模型上下文', contextSummary(state.context))
      await this.requestRemoteApproval(state)
    })
    return structuredClone(run)
  }

  async continue(input: AgentContinueRequest): Promise<AgentRun> {
    const continuation = agentContinueRequestSchema.parse(input)
    const state = this.executions.get(continuation.runId)
    if (!state) throw new Error('Agent run is not active')
    if (state.run.status !== 'waiting-input') throw new Error('Agent run is not waiting for input')
    if (continuation.assistantMessageId) state.run.assistantMessageId = continuation.assistantMessageId
    state.run.pendingClarification = undefined
    state.input.push({ role: 'user', content: [{ type: 'input_text', text: continuation.message }] })
    await this.timeline(state, 'request', 'completed', '收到补充信息', continuation.message)
    await this.guard(state, () => this.drive(state))
    return structuredClone(state.run)
  }

  get(runId: string): AgentRunDetail | undefined { return this.options.store.get(runId) }
  list(): AgentRun[] { return this.options.store.list() }

  async decide(input: ApprovalDecision): Promise<AgentRun> {
    const state = [...this.executions.values()].find(candidate => candidate.run.pendingApproval?.id === input.approvalId)
    if (!state?.run.pendingApproval) throw new Error('Approval is not pending')
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
        state.input.push({
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(state.context) }]
        })
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
      const call = state.pendingCall
      delete state.pendingCall
      await this.executeTool(state, call)
      await this.drive(state)
    })
    return structuredClone(state.run)
  }

  async cancel(runId: string): Promise<AgentRun> {
    const state = this.executions.get(runId)
    if (!state) {
      const existing = this.options.store.get(runId)
      if (!existing) throw new Error('Agent run not found')
      return existing
    }
    state.controller.abort(new Error('Agent run cancelled'))
    state.run.pendingApproval = undefined
    state.run.pendingClarification = undefined
    state.run.response = '任务已取消。'
    await this.setStatus(state, 'cancelled')
    state.run.completedAt = state.run.updatedAt
    await this.persist(state)
    await this.timeline(state, 'cancelled', 'cancelled', '任务取消', '用户停止了 Agent 任务。')
    this.executions.delete(runId)
    return structuredClone(state.run)
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.executions.keys()].map(runId => this.cancel(runId)))
  }

  private async requestRemoteApproval(state: OpenAiExecutionState): Promise<void> {
    if (!state.model || !state.context) throw new AgentLoopFailure('AGENT_STATE_INVALID', '模型上下文尚未准备。')
    const approval: Approval = {
      id: crypto.randomUUID(), runId: state.run.id, stepId: 'model-context', toolName: 'model.remote-context',
      risk: 'L3', title: '发送上下文到 OpenAI 模型',
      description: `将当前任务的受限上下文发送到模型配置“${state.model.profile.name}”。`,
      parameterSummary: {
        profile: state.model.profile.name,
        activeFile: state.context.task.activeFile ?? null,
        relatedFiles: state.context.workspace.relatedFiles.length,
        promptCharacters: state.context.task.prompt.length
      },
      sideEffects: ['remote-request'], status: 'pending', createdAt: new Date().toISOString()
    }
    state.run.pendingApproval = approval
    await this.options.store.saveApproval(approval)
    await this.setStatus(state, 'waiting-model-approval')
    await this.timeline(state, 'approval', 'waiting', '等待模型上下文审批', approval.description, approval.stepId)
  }

  private async drive(state: OpenAiExecutionState): Promise<void> {
    if (!state.model || !state.context || !state.remoteContextApproved) {
      throw new AgentLoopFailure('AGENT_STATE_INVALID', '模型循环尚未准备。')
    }
    while (!isTerminal(state.run.status)) {
      this.checkDeadline(state)
      const maxTurns = Math.min(this.maxModelTurns, state.context.policy.maxModelTurns)
      if (state.modelTurns >= maxTurns) throw new AgentLoopFailure('MODEL_TURN_LIMIT', `模型轮次超过上限 ${maxTurns}。`)
      state.modelTurns += 1
      await this.setStatus(state, 'model-requesting')
      const response = await this.withDeadline(state, signal => state.model!.respond(structuredClone(state.input), signal))
      await this.setStatus(state, 'validating-model-output')
      state.input.push(...response.output.map(item => structuredClone(item) as OpenAiResponseInputItem))
      const calls = response.output.filter((item): item is Extract<OpenAiResponseOutputItem, { type: 'function_call' }> => item.type === 'function_call')
      const messages = response.output.filter((item): item is Extract<OpenAiResponseOutputItem, { type: 'message' }> => item.type === 'message')
      if (calls.length > 1 || (calls.length && messages.length)) {
        throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型必须一次返回一个工具调用或一个最终响应。')
      }
      if (calls.length === 1) {
        await this.acceptToolCall(state, calls[0]!)
        if (state.run.status === 'waiting-approval') return
        continue
      }
      try {
        await this.acceptFinal(state, messages)
        return
      } catch (error) {
        if (error instanceof AgentLoopFailure && error.code === 'MODEL_PROTOCOL_INVALID' && state.finalRepairAttempts < 1) {
          state.finalRepairAttempts += 1
          state.input.push({
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Your previous final response was invalid: ${error.message}. Return exactly one valid cpppilot.final.v1 JSON object matching the required schema.`
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
    let rawArguments: unknown
    try { rawArguments = JSON.parse(item.arguments) } catch {
      throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', `工具 ${item.name} 的 arguments 不是有效 JSON。`)
    }
    let parsed: ReturnType<OpenAiAgentToolRegistry['parse']>
    try {
      parsed = this.options.registry.parse(item.name, rawArguments)
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
        summary: `工具参数校验失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 20_000),
        exitCode: null, diagnostics: [], artifacts: [], changedFiles: [], retryable: true,
        errorCode: 'TOOL_ARGUMENT_INVALID', durationMs: 0, outputTruncated: false
      })
      await this.recordObservation(state, pending, output, 'failed')
      return
    }
    this.enforceToolPolicy(state, parsed.arguments)
    const stepId = `tool-${state.toolCalls + 1}`
    const call: PendingToolCall = { item, ...parsed, stepId }
    state.toolCalls += 1
    state.run.steps.push({
      id: stepId, sequence: state.run.steps.length, title: parsed.definition.title,
      kind: parsed.definition.name.includes('build') || parsed.definition.name.includes('test') ? 'validate' : 'tool',
      status: 'pending', toolName: parsed.definition.name
    })
    await this.persist(state)

    if (parsed.definition.risk === 'L2' || parsed.definition.risk === 'L3') {
      state.pendingCall = call
      const approval: Approval = {
        id: crypto.randomUUID(), runId: state.run.id, stepId, toolName: parsed.definition.name,
        risk: parsed.definition.risk, title: parsed.definition.title,
        description: `Agent 请求执行 ${parsed.definition.name}。`,
        parameterSummary: summarizeParameters(parsed.arguments),
        ...(createApprovalDiff(parsed.definition.name, parsed.arguments, state.context) ? {
          diff: createApprovalDiff(parsed.definition.name, parsed.arguments, state.context)
        } : {}),
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
      await this.options.store.saveToolCall({
        ...call, status: state.controller.signal.aborted ? 'cancelled' : 'failed', finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        errorCode: state.controller.signal.aborted ? 'CANCELLED' : 'MCP_CALL_FAILED'
      })
      throw error
    }
    const finishedAt = new Date().toISOString()
    await this.options.store.saveToolCall({
      ...call, result, status: result.ok ? 'completed' : 'failed', finishedAt,
      durationMs: result.durationMs, ...(result.errorCode ? { errorCode: result.errorCode } : {})
    })
    const output = toolOutputFor(state, pending, result)
    await this.recordObservation(state, pending, output, result.ok ? 'completed' : 'failed')
  }

  private async recordObservation(
    state: OpenAiExecutionState,
    pending: PendingToolCall,
    output: CppPilotToolOutput,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
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
  }

  private rejectedToolOutput(state: OpenAiExecutionState, call: PendingToolCall, reason?: string): CppPilotToolOutput {
    return cppPilotToolOutputSchema.parse({
      protocol: 'cpppilot.tool-output.v1', taskId: state.request.requestId, callId: call.item.call_id,
      tool: call.definition.name, ok: false, summary: reason ? `用户拒绝工具调用：${reason}` : '用户拒绝工具调用。',
      exitCode: null, diagnostics: [], artifacts: [], changedFiles: [], retryable: false,
      errorCode: 'TOOL_REJECTED', durationMs: 0, outputTruncated: false
    })
  }

  private async acceptFinal(
    state: OpenAiExecutionState,
    messages: Array<Extract<OpenAiResponseOutputItem, { type: 'message' }>>
  ): Promise<void> {
    if (messages.length !== 1) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型未返回工具调用或最终响应。')
    const refusals = messages[0]!.content.filter(item => item.type === 'refusal')
    if (refusals.length) throw new AgentLoopFailure('MODEL_REFUSED', refusals.map(item => item.refusal).join('\n'))
    const texts = messages[0]!.content.filter(item => item.type === 'output_text')
    if (texts.length !== 1) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型最终响应必须包含一个 output_text。')
    let raw: unknown
    try { raw = JSON.parse(texts[0]!.text) } catch {
      throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '模型最终响应不是有效 JSON。')
    }
    const parsed = cppPilotFinalResponseSchema.safeParse(raw)
    if (!parsed.success) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', parsed.error.issues.map(issue => issue.message).join('；'))
    const final = parsed.data
    if (final.taskId !== state.request.requestId) throw new AgentLoopFailure('MODEL_PROTOCOL_INVALID', '最终响应 taskId 与当前任务不一致。')
    this.validateEvidence(state, final)
    state.run.intent = final.intent.primary
    state.run.response = final.messageMarkdown

    if (final.status === 'needs_input') {
      state.run.pendingClarification = { question: final.clarificationQuestion!, requestedAt: new Date().toISOString() }
      await this.setStatus(state, 'waiting-input')
      await this.timeline(state, 'response', 'waiting', '等待用户补充信息', final.clarificationQuestion!)
      return
    }
    if (final.status === 'failed') {
      state.run.errorCode = 'MODEL_REPORTED_FAILURE'
      state.run.errorMessage = final.messageMarkdown
      await this.setStatus(state, 'failed')
      state.run.completedAt = state.run.updatedAt
      await this.persist(state)
      await this.timeline(state, 'response', 'failed', '模型报告任务失败', final.messageMarkdown)
      this.executions.delete(state.run.id)
      return
    }
    await this.setStatus(state, 'completed')
    state.run.completedAt = state.run.updatedAt
    state.run.validationSummary = evidenceSummary(final, state.evidence)
    await this.persist(state)
    await this.timeline(state, 'response', 'completed', '完成回答', final.messageMarkdown)
    this.executions.delete(state.run.id)
  }

  private validateEvidence(state: OpenAiExecutionState, final: CppPilotFinalResponse): void {
    for (const callId of final.evidenceCallIds) {
      const evidence = state.evidence.get(callId)
      if (!evidence?.ok) throw new AgentLoopFailure('MODEL_EVIDENCE_INVALID', `最终响应引用了不存在或失败的证据：${callId}`)
    }
    if (final.status !== 'completed') return
    if (final.intent.primary === 'edit_code') {
      const changed = final.evidenceCallIds.some(callId => (state.evidence.get(callId)?.changedFiles.length ?? 0) > 0)
      if (!changed) throw new AgentLoopFailure('MODEL_EVIDENCE_INVALID', '代码修改完成状态缺少成功的文件变更证据。')
    }
    if (['create_project', 'environment_setup'].includes(final.intent.primary) && final.evidenceCallIds.length === 0) {
      throw new AgentLoopFailure('MODEL_EVIDENCE_INVALID', '操作完成状态缺少成功工具证据。')
    }
  }

  private enforceToolPolicy(state: OpenAiExecutionState, args: Record<string, unknown>): void {
    const allowedProjectId = state.context?.policy.allowedProjectId
    if (allowedProjectId && typeof args.projectId === 'string' && args.projectId !== allowedProjectId) {
      throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', '工具调用试图访问当前任务之外的项目。')
    }
    if (state.request.projectId && typeof args.projectId === 'string' && args.projectId !== state.request.projectId) {
      throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', '工具 projectId 与当前项目不一致。')
    }
    if (typeof args.relativePath === 'string') {
      const normalized = args.relativePath.replaceAll('\\', '/')
      if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
        throw new AgentLoopFailure('TOOL_POLICY_VIOLATION', '工具路径必须位于当前项目内。')
      }
    }
  }

  private async guard(state: OpenAiExecutionState, operation: () => Promise<void>): Promise<void> {
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
    if (Date.now() >= state.deadline) throw new AgentLoopFailure('AGENT_TIMEOUT', 'Agent 任务超过总时限。')
  }

  private async withDeadline<T>(state: OpenAiExecutionState, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.checkDeadline(state)
    const remaining = state.deadline - Date.now()
    const timeout = new AbortController()
    const signal = AbortSignal.any([state.controller.signal, timeout.signal])
    const timer = setTimeout(() => timeout.abort(new AgentLoopFailure('AGENT_TIMEOUT', 'Agent 任务超过总时限。')), remaining)
    try {
      return await operation(signal)
    } finally {
      clearTimeout(timer)
    }
  }

  private async setStatus(state: OpenAiExecutionState, status: AgentRun['status']): Promise<void> {
    state.run.status = status
    state.run.updatedAt = new Date().toISOString()
    await this.persist(state)
  }

  private async persist(state: OpenAiExecutionState): Promise<void> {
    await this.options.store.update(state.run)
    this.publish(state.run)
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

function toolOutputFor(state: OpenAiExecutionState, pending: PendingToolCall, result: ToolResult): CppPilotToolOutput {
  return cppPilotToolOutputSchema.parse({
    protocol: 'cpppilot.tool-output.v1', taskId: state.request.requestId, callId: pending.item.call_id,
    tool: pending.definition.name, ok: result.ok, summary: result.summary.slice(0, 20_000), exitCode: result.exitCode,
    diagnostics: result.diagnostics.slice(0, 200).map(item => ({
      source: item.source, severity: item.severity, ...(item.code ? { code: item.code } : {}),
      ...(item.file && isRelativePath(item.file) ? { file: item.file } : {}),
      ...(item.line ? { line: item.line } : {}), ...(item.column ? { column: item.column } : {}),
      message: (item.normalizedMessage || item.rawMessage).slice(0, 20_000)
    })),
    artifacts: result.artifacts.slice(0, 100).map(item => ({ id: item.id, kind: item.kind, label: item.label })),
    changedFiles: result.sideEffects
      .filter(item => ['write-file', 'create-file', 'delete-file'].includes(item.kind) && isRelativePath(item.target))
      .map(item => item.target).slice(0, 100),
    ...(isRecord(result.structuredContent) ? { data: sanitizeToolData(result.structuredContent) } : {}),
    retryable: result.retryable, ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    durationMs: result.durationMs, outputTruncated: result.diagnostics.length > 200 || result.artifacts.length > 100
  })
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

function isRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized) && !normalized.split('/').includes('..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeToolData(value: Record<string, unknown>): Record<string, unknown> {
  const sanitize = (item: unknown, key: string, depth: number): unknown => {
    if (depth > 6) return '[truncated]'
    if (typeof item === 'string') {
      if (/secret|token|api.?key|authorization/i.test(key)) return '[redacted]'
      if (/path|root|directory|executable/i.test(key) && !isRelativePath(item)) return '[local path redacted]'
      return item.length > 100_000 ? `${item.slice(0, 100_000)}...` : item
    }
    if (Array.isArray(item)) return item.slice(0, 200).map(entry => sanitize(entry, key, depth + 1))
    if (isRecord(item)) {
      return Object.fromEntries(Object.entries(item).slice(0, 200).map(([nestedKey, nested]) => [
        nestedKey,
        sanitize(nested, nestedKey, depth + 1)
      ]))
    }
    return item
  }
  return sanitize(value, '', 0) as Record<string, unknown>
}

function createApprovalDiff(
  toolName: string,
  args: Record<string, unknown>,
  context?: CppPilotContextEnvelope
): string | undefined {
  if (toolName !== 'workspace.apply_patch' || typeof args.content !== 'string' || typeof args.relativePath !== 'string') return undefined
  const current = context?.workspace.activeFile
  if (!current || current.path !== args.relativePath || current.content === args.content) return undefined
  return lineDiff(current.content, args.content, args.relativePath).slice(0, 100_000)
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
