import {
  agentStartRequestSchema,
  type AgentRun,
  type AgentRunDetail,
  type AgentStartRequest,
  type AgentStep,
  type Approval,
  type ApprovalDecision,
  type ContextPacket,
  type KnowledgeGateResult,
  type LearnerKnowledge,
  type TimelineEvent,
  type ToolResult,
  type ToolRisk
} from '@cpp-pet/contracts'

export type ResolvedAgentRequest = ReturnType<typeof agentStartRequestSchema.parse>

export interface RuntimePlanStep {
  id: string
  title: string
  kind: AgentStep['kind']
  toolName?: string
  risk?: ToolRisk
  arguments?: Record<string, unknown>
  sideEffects?: string[]
  summary?: string
  continueOnFailure?: boolean
}

export interface RuntimePlan {
  intent: string
  conceptIds: string[]
  successCriteria: string[]
  steps: RuntimePlanStep[]
  source?: 'model' | 'offline'
  fallbackReason?: string
}

export interface RuntimeContextBuilder {
  build(request: ResolvedAgentRequest, signal: AbortSignal): Promise<ContextPacket>
}

export interface RuntimePlanner {
  plan(request: ResolvedAgentRequest, context: ContextPacket, signal: AbortSignal): Promise<RuntimePlan>
}

export interface RuntimeToolClient {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>
}

export interface RuntimeKnowledgeGate {
  check(conceptIds: string[], states: LearnerKnowledge[], options?: { allowRewrite?: boolean }): KnowledgeGateResult
}

export interface RuntimeStore {
  create(run: AgentRun): void | Promise<void>
  update(run: AgentRun): void | Promise<void>
  append(event: TimelineEvent): void | Promise<void>
  saveApproval(approval: Approval): void | Promise<void>
  get(runId: string): AgentRunDetail | undefined
  list(): AgentRun[]
  learnerKnowledge(userId: string): LearnerKnowledge[] | Promise<LearnerKnowledge[]>
}

interface ExecutionState {
  request: ResolvedAgentRequest
  run: AgentRun
  controller: AbortController
  plan?: RuntimePlan
  context?: ContextPacket
  index: number
  toolCalls: number
  approvedSteps: Set<string>
  results: Map<string, unknown>
  deadline: number
}

export interface AgentRuntimeOptions {
  store: RuntimeStore
  contextBuilder: RuntimeContextBuilder
  planner: RuntimePlanner
  toolClient: RuntimeToolClient
  knowledgeGate: RuntimeKnowledgeGate
  maxSteps?: number
  maxToolCalls?: number
  maxRetries?: number
  totalTimeoutMs?: number
}

export class InMemoryRuntimeStore implements RuntimeStore {
  private readonly runs = new Map<string, AgentRun>()
  private readonly timeline = new Map<string, TimelineEvent[]>()
  private readonly approvals = new Map<string, Approval[]>()
  private knowledge: LearnerKnowledge[] = []

  create(run: AgentRun): void { this.runs.set(run.id, structuredClone(run)) }
  update(run: AgentRun): void { this.runs.set(run.id, structuredClone(run)) }
  append(event: TimelineEvent): void {
    const events = this.timeline.get(event.runId) ?? []
    events.push(structuredClone(event))
    this.timeline.set(event.runId, events)
  }
  saveApproval(approval: Approval): void {
    const items = this.approvals.get(approval.runId) ?? []
    const index = items.findIndex(item => item.id === approval.id)
    if (index >= 0) items[index] = structuredClone(approval)
    else items.push(structuredClone(approval))
    this.approvals.set(approval.runId, items)
  }
  get(runId: string): AgentRunDetail | undefined {
    const run = this.runs.get(runId)
    return run ? {
      ...structuredClone(run),
      timeline: structuredClone(this.timeline.get(runId) ?? []),
      approvals: structuredClone(this.approvals.get(runId) ?? [])
    } : undefined
  }
  list(): AgentRun[] { return [...this.runs.values()].map(run => structuredClone(run)) }
  learnerKnowledge(userId: string): LearnerKnowledge[] { return this.knowledge.filter(item => item.userId === userId).map(item => structuredClone(item)) }
  setLearnerKnowledge(items: LearnerKnowledge[]): void { this.knowledge = structuredClone(items) }
}

export class AgentRuntime {
  private readonly executions = new Map<string, ExecutionState>()
  private readonly maxSteps: number
  private readonly maxToolCalls: number
  private readonly maxRetries: number
  private readonly totalTimeoutMs: number

  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxSteps = options.maxSteps ?? 12
    this.maxToolCalls = options.maxToolCalls ?? 8
    this.maxRetries = options.maxRetries ?? 1
    this.totalTimeoutMs = options.totalTimeoutMs ?? 120_000
  }

  async start(input: AgentStartRequest): Promise<AgentRun> {
    const request = agentStartRequestSchema.parse(input)
    const now = new Date().toISOString()
    const run: AgentRun = {
      id: crypto.randomUUID(),
      requestId: request.requestId,
      source: request.source,
      mode: request.mode,
      message: request.message,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.activeFile ? { activeFile: request.activeFile } : {}),
      status: 'queued',
      steps: [],
      createdAt: now,
      updatedAt: now
    }
    const state: ExecutionState = {
      request,
      run,
      controller: new AbortController(),
      index: 0,
      toolCalls: 0,
      approvedSteps: new Set(),
      results: new Map(),
      deadline: Date.now() + this.totalTimeoutMs
    }
    this.executions.set(run.id, state)
    await this.options.store.create(run)
    await this.timeline(state, 'request', 'completed', '收到请求', request.message)

    try {
      await this.prepare(state)
      if (!this.isTerminal(run.status) && run.status !== 'waiting-approval') await this.advance(state)
    } catch (error) {
      if (!state.controller.signal.aborted && !this.isTerminal(run.status)) {
        await this.fail(state, 'AGENT_RUNTIME_ERROR', error instanceof Error ? error.message : String(error))
      }
    }
    if (this.isTerminal(run.status)) this.executions.delete(run.id)
    return structuredClone(run)
  }

  get(runId: string): AgentRunDetail | undefined { return this.options.store.get(runId) }
  list(): AgentRun[] { return this.options.store.list() }

  async decide(input: ApprovalDecision): Promise<AgentRun> {
    const state = [...this.executions.values()].find(candidate => candidate.run.pendingApproval?.id === input.approvalId)
    if (!state?.run.pendingApproval) throw new Error('Approval is not pending')
    const approval: Approval = {
      ...state.run.pendingApproval,
      status: input.decision,
      ...(input.reason ? { decisionReason: input.reason } : {}),
      decidedAt: new Date().toISOString()
    }
    await this.options.store.saveApproval(approval)
    await this.timeline(state, 'approval', 'completed', input.decision === 'approved' ? '审批通过' : '审批拒绝', input.reason ?? approval.title, approval.stepId)
    state.run.pendingApproval = undefined

    if (input.decision === 'rejected') {
      const step = state.run.steps[state.index]
      if (step) step.status = 'cancelled'
      state.run.response = input.reason ? `操作已拒绝：${input.reason}` : '操作已由用户拒绝。'
      await this.setStatus(state, 'cancelled')
      this.executions.delete(state.run.id)
      return structuredClone(state.run)
    }

    state.approvedSteps.add(approval.stepId)
    await this.setStatus(state, 'executing')
    await this.advance(state)
    if (this.isTerminal(state.run.status)) this.executions.delete(state.run.id)
    return structuredClone(state.run)
  }

  async cancel(runId: string): Promise<AgentRun> {
    const state = this.executions.get(runId)
    if (!state) {
      const run = this.options.store.get(runId)
      if (!run) throw new Error('Agent run not found')
      return run
    }
    state.controller.abort(new Error('Agent run cancelled'))
    if (!this.isTerminal(state.run.status)) {
      state.run.pendingApproval = undefined
      state.run.response = '任务已取消。'
      await this.setStatus(state, 'cancelled')
      await this.timeline(state, 'cancelled', 'cancelled', '任务取消', '用户停止了 Agent 任务。')
    }
    return structuredClone(state.run)
  }

  private async prepare(state: ExecutionState): Promise<void> {
    await this.setStatus(state, 'contextualizing')
    state.context = await this.options.contextBuilder.build(state.request, state.controller.signal)
    await this.timeline(state, 'context', 'completed', '构建上下文', `使用 ${state.context.sources.length} 个来源。`, undefined, {
      sources: state.context.sources.map(source => ({ kind: source.kind, label: source.label })),
      tokenEstimate: state.context.tokenEstimate,
      truncated: state.context.truncated
    })

    await this.setStatus(state, 'planning')
    state.plan = await this.options.planner.plan(state.request, state.context, state.controller.signal)
    if (state.plan.steps.length > this.maxSteps) {
      await this.fail(state, 'PLAN_STEP_LIMIT', `计划包含 ${state.plan.steps.length} 个步骤，超过上限 ${this.maxSteps}。`)
      return
    }
    state.run.intent = state.plan.intent
    state.run.planSummary = state.plan.steps.map(step => step.title).join(' → ')
    state.run.steps = state.plan.steps.map((step, sequence) => ({
      id: step.id,
      sequence,
      title: step.title,
      kind: step.kind,
      status: 'pending',
      ...(step.toolName ? { toolName: step.toolName } : {}),
      ...(step.summary ? { summary: step.summary } : {})
    }))
    await this.options.store.update(state.run)
    await this.timeline(state, 'intent', 'completed', '识别任务意图', state.plan.intent)
    await this.timeline(state, 'plan', 'completed', '生成执行计划', state.run.planSummary, undefined, { successCriteria: state.plan.successCriteria })

    await this.setStatus(state, 'policy-check')
    const learnerState = await this.options.store.learnerKnowledge('local-user')
    const decision = this.options.knowledgeGate.check(state.plan.conceptIds, learnerState, { allowRewrite: true })
    await this.timeline(state, 'policy', 'completed', '知识边界检查', decision.explanation, undefined, { decision: decision.decision, blocked: decision.blocked })
    if (decision.decision !== 'allow') {
      state.run.response = `${decision.explanation}${decision.suggestedConceptIds.length ? ` 建议先学习：${decision.suggestedConceptIds.join('、')}。` : ''}`
      await this.complete(state)
    }
  }

  private async advance(state: ExecutionState): Promise<void> {
    const plan = state.plan
    if (!plan || this.isTerminal(state.run.status)) return
    while (state.index < plan.steps.length) {
      if (state.controller.signal.aborted || this.isTerminal(state.run.status)) return
      if (Date.now() > state.deadline) { await this.fail(state, 'AGENT_TIMEOUT', 'Agent 任务超过总时限。'); return }
      const planStep = plan.steps[state.index]
      const step = state.run.steps[state.index]
      if (!planStep || !step) { await this.fail(state, 'PLAN_STATE_INVALID', '计划步骤状态不一致。'); return }

      const risk = planStep.risk ?? 'L0'
      if ((risk === 'L2' || risk === 'L3' || planStep.kind === 'approval') && !state.approvedSteps.has(planStep.id)) {
        const approval: Approval = {
          id: crypto.randomUUID(),
          runId: state.run.id,
          stepId: planStep.id,
          toolName: planStep.toolName ?? `policy.${planStep.id}`,
          risk,
          title: planStep.title,
          description: `Agent 请求执行 ${planStep.toolName}。`,
          parameterSummary: planStep.arguments ?? {},
          sideEffects: planStep.sideEffects ?? [],
          status: 'pending',
          createdAt: new Date().toISOString()
        }
        step.status = 'waiting'
        state.run.pendingApproval = approval
        await this.options.store.saveApproval(approval)
        await this.setStatus(state, 'waiting-approval')
        await this.timeline(state, 'approval', 'waiting', '等待用户审批', `${planStep.title}（${risk}）`, planStep.id)
        return
      }

      if (!planStep.toolName) {
        step.status = 'completed'
        step.startedAt = new Date().toISOString()
        step.finishedAt = step.startedAt
        await this.options.store.update(state.run)
        state.index += 1
        continue
      }

      if (state.toolCalls >= this.maxToolCalls) { await this.fail(state, 'TOOL_CALL_LIMIT', `工具调用超过上限 ${this.maxToolCalls}。`); return }
      const isValidation = planStep.kind === 'validate'
      await this.setStatus(state, isValidation ? 'validating' : 'executing')
      step.status = 'running'
      step.startedAt = new Date().toISOString()
      await this.options.store.update(state.run)

      let result: ToolResult | undefined
      const resolvedArguments = this.resolveValue(planStep.arguments ?? {}, state.results) as Record<string, unknown>
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        state.toolCalls += 1
        result = await this.options.toolClient.call(planStep.toolName, resolvedArguments, state.controller.signal)
        if (result.ok || !result.retryable || attempt === this.maxRetries) break
      }
      if (state.controller.signal.aborted || this.isTerminal(state.run.status)) return
      if (!result?.ok && !planStep.continueOnFailure) {
        step.status = 'failed'
        step.summary = result?.summary ?? '工具未返回结果。'
        step.finishedAt = new Date().toISOString()
        await this.fail(state, result?.errorCode ?? 'TOOL_FAILED', step.summary)
        return
      }

      state.results.set(planStep.id, result?.structuredContent ?? result)
      step.status = 'completed'
      step.summary = result?.summary ?? '工具未返回摘要。'
      step.finishedAt = new Date().toISOString()
      await this.options.store.update(state.run)
      const eventKind = isValidation ? 'validation' : planStep.kind === 'learning' ? 'learning' : 'tool'
      await this.timeline(
        state,
        eventKind,
        'completed',
        planStep.title,
        step.summary,
        planStep.id,
        { toolName: planStep.toolName, exitCode: result?.exitCode ?? null, diagnostics: result?.diagnostics.length ?? 0, durationMs: result?.durationMs ?? 0, expectedFailure: !result?.ok && Boolean(planStep.continueOnFailure) }
      )
      state.index += 1
    }
    await this.complete(state)
  }

  private async complete(state: ExecutionState): Promise<void> {
    if (this.isTerminal(state.run.status)) return
    await this.setStatus(state, 'responding')
    state.run.response ??= '任务已根据工具证据完成。'
    state.run.validationSummary = state.run.steps.filter(step => step.kind === 'validate').map(step => step.summary).filter(Boolean).join('；') || '计划步骤已完成。'
    await this.setStatus(state, 'completed')
    state.run.completedAt = state.run.updatedAt
    await this.options.store.update(state.run)
    await this.timeline(state, 'response', 'completed', '完成回答', state.run.response)
  }

  private async fail(state: ExecutionState, code: string, message: string): Promise<void> {
    state.run.errorCode = code
    state.run.errorMessage = message
    state.run.response = `任务未完成：${message}`
    await this.setStatus(state, 'failed')
    state.run.completedAt = state.run.updatedAt
    await this.options.store.update(state.run)
    await this.timeline(state, 'error', 'failed', '任务失败', message, undefined, { errorCode: code })
  }

  private async setStatus(state: ExecutionState, status: AgentRun['status']): Promise<void> {
    state.run.status = status
    state.run.updatedAt = new Date().toISOString()
    await this.options.store.update(state.run)
  }

  private async timeline(
    state: ExecutionState,
    kind: TimelineEvent['kind'],
    status: TimelineEvent['status'],
    title: string,
    summary: string,
    stepId?: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const detail = this.options.store.get(state.run.id)
    const event: TimelineEvent = {
      id: crypto.randomUUID(),
      runId: state.run.id,
      sequence: detail?.timeline.length ?? 0,
      kind,
      status,
      title,
      summary,
      occurredAt: new Date().toISOString(),
      ...(stepId ? { stepId } : {}),
      ...(data ? { data } : {})
    }
    await this.options.store.append(event)
  }

  private isTerminal(status: AgentRun['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
  }

  private resolveValue(value: unknown, results: Map<string, unknown>): unknown {
    if (Array.isArray(value)) return value.map(item => this.resolveValue(item, results))
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    if (typeof record.$from === 'string') {
      let resolved = results.get(record.$from)
      if (typeof record.$path === 'string' && record.$path) {
        for (const segment of record.$path.split('.')) {
          if (resolved === null || resolved === undefined) break
          if (Array.isArray(resolved)) resolved = resolved[Number(segment)]
          else if (typeof resolved === 'object') resolved = (resolved as Record<string, unknown>)[segment]
          else resolved = undefined
        }
      }
      if (resolved === undefined) throw new Error(`Missing result reference: ${record.$from}.${String(record.$path ?? '')}`)
      return resolved
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, this.resolveValue(item, results)]))
  }
}
