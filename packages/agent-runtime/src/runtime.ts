import {
  agentStartRequestSchema,
  type AgentRun,
  type AgentRunDetail,
  type AgentStartRequest,
  type AgentStep,
  type Approval,
  type ApprovalDecision,
  type ContextPacket,
  type TimelineEvent,
  type ToolCall,
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
  contextApproval?(request: ResolvedAgentRequest, context: ContextPacket): RuntimeContextApproval | undefined | Promise<RuntimeContextApproval | undefined>
  plan(request: ResolvedAgentRequest, context: ContextPacket, signal: AbortSignal): Promise<RuntimePlan>
}

export interface RuntimeContextApproval {
  risk: 'L3'
  title: string
  description: string
  parameterSummary: Record<string, unknown>
  sideEffects: string[]
}

export interface RuntimeToolClient {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal, onProgress?: (event: RuntimeToolProgress) => void | Promise<void>): Promise<ToolResult>
}

export interface RuntimeToolProgress {
  progress: number
  total?: number
  message: string
}

export interface RuntimeStore {
  create(run: AgentRun): void | Promise<void>
  update(run: AgentRun): void | Promise<void>
  append(event: TimelineEvent): void | Promise<void>
  saveApproval(approval: Approval): void | Promise<void>
  saveToolCall(call: ToolCall): void | Promise<void>
  get(runId: string): AgentRunDetail | undefined
  list(): AgentRun[]
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
  contextApprovalGranted: boolean
}

class RuntimeDeadlineError extends Error {
  constructor() {
    super('Agent 任务超过总时限。')
    this.name = 'RuntimeDeadlineError'
  }
}

export interface AgentRuntimeOptions {
  store: RuntimeStore
  contextBuilder: RuntimeContextBuilder
  planner: RuntimePlanner
  toolClient: RuntimeToolClient
  /** @deprecated Kept for old hosts; it no longer controls task execution. */
  knowledgeGate?: { check(...args: never[]): unknown }
  maxSteps?: number
  maxToolCalls?: number
  maxRetries?: number
  totalTimeoutMs?: number
}

export class InMemoryRuntimeStore implements RuntimeStore {
  private readonly runs = new Map<string, AgentRun>()
  private readonly timeline = new Map<string, TimelineEvent[]>()
  private readonly approvals = new Map<string, Approval[]>()
  private readonly toolCalls = new Map<string, ToolCall[]>()

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
  saveToolCall(call: ToolCall): void {
    const items = this.toolCalls.get(call.runId) ?? []
    const index = items.findIndex(item => item.id === call.id)
    if (index >= 0) items[index] = structuredClone(call)
    else items.push(structuredClone(call))
    this.toolCalls.set(call.runId, items)
  }
  get(runId: string): AgentRunDetail | undefined {
    const run = this.runs.get(runId)
    return run ? {
      ...structuredClone(run),
      timeline: structuredClone(this.timeline.get(runId) ?? []),
      approvals: structuredClone(this.approvals.get(runId) ?? []),
      toolCalls: structuredClone(this.toolCalls.get(runId) ?? [])
    } : undefined
  }
  list(): AgentRun[] { return [...this.runs.values()].map(run => structuredClone(run)) }
}

export class AgentRuntime {
  private readonly executions = new Map<string, ExecutionState>()
  private readonly listeners = new Set<(run: AgentRun) => void>()
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

  onChanged(listener: (run: AgentRun) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
      deadline: Date.now() + this.totalTimeoutMs,
      contextApprovalGranted: false
    }
    this.executions.set(run.id, state)
    await this.options.store.create(run)
    this.publish(run)
    await this.timeline(state, 'request', 'completed', '收到请求', request.message)

    try {
      await this.prepare(state)
      if (!this.isTerminal(run.status) && run.status !== 'waiting-approval') await this.advance(state)
    } catch (error) {
      if (error instanceof RuntimeDeadlineError && !this.isTerminal(run.status)) {
        await this.fail(state, 'AGENT_TIMEOUT', error.message)
      } else if (!state.controller.signal.aborted && !this.isTerminal(run.status)) {
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

    if (approval.toolName === 'model.remote-context') {
      state.contextApprovalGranted = true
      await this.preparePlan(state)
      if (!this.isTerminal(state.run.status) && state.run.status !== 'waiting-approval') await this.advance(state)
    } else {
      state.approvedSteps.add(approval.stepId)
      await this.setStatus(state, 'executing')
      await this.advance(state)
    }
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
    this.executions.delete(runId)
    return structuredClone(state.run)
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.executions.keys()].map(runId => this.cancel(runId)))
  }

  private async prepare(state: ExecutionState): Promise<void> {
    await this.setStatus(state, 'contextualizing')
    state.context = await this.withDeadline(state, signal => this.options.contextBuilder.build(state.request, signal))
    await this.timeline(state, 'context', 'completed', '构建上下文', `使用 ${state.context.sources.length} 个来源。`, undefined, {
      sources: state.context.sources.map(source => ({ kind: source.kind, label: source.label })),
      tokenEstimate: state.context.tokenEstimate,
      truncated: state.context.truncated
    })

    const contextApproval = await this.withDeadline(state, async () => this.options.planner.contextApproval?.(state.request, state.context!))
    if (contextApproval && !state.contextApprovalGranted) {
      const approval: Approval = {
        id: crypto.randomUUID(), runId: state.run.id, stepId: 'model-context', toolName: 'model.remote-context',
        risk: contextApproval.risk, title: contextApproval.title, description: contextApproval.description,
        parameterSummary: contextApproval.parameterSummary, sideEffects: contextApproval.sideEffects,
        status: 'pending', createdAt: new Date().toISOString()
      }
      state.run.pendingApproval = approval
      await this.options.store.saveApproval(approval)
      await this.setStatus(state, 'waiting-approval')
      await this.timeline(state, 'approval', 'waiting', '等待远程上下文审批', contextApproval.description, approval.stepId)
      return
    }

    await this.preparePlan(state)
  }

  private async preparePlan(state: ExecutionState): Promise<void> {
    if (!state.context) throw new Error('Agent context is not available')
    await this.setStatus(state, 'planning')
    state.plan = await this.withDeadline(state, signal => this.options.planner.plan(state.request, state.context!, signal))
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
    await this.persist(state)
    await this.timeline(state, 'intent', 'completed', '识别任务意图', state.plan.intent)
    await this.timeline(state, 'plan', 'completed', '生成执行计划', state.run.planSummary, undefined, { successCriteria: state.plan.successCriteria })

    await this.setStatus(state, 'policy-check')
    const explanationContext = state.context.explanationContext
    await this.timeline(
      state,
      'policy',
      'completed',
      '讲解背景已应用',
      explanationContext?.instructions ?? '未设置学习背景，按当前问题直接讲解。',
      undefined,
      {
        knownConceptIds: explanationContext?.knownConceptIds ?? [],
        focusConceptIds: explanationContext?.focusConceptIds ?? [],
        unseenConceptIds: explanationContext?.unseenConceptIds ?? state.plan.conceptIds
      }
    )
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
        const diff = createPatchApprovalDiff(planStep, state.context)
        const approval: Approval = {
          id: crypto.randomUUID(),
          runId: state.run.id,
          stepId: planStep.id,
          toolName: planStep.toolName ?? `policy.${planStep.id}`,
          risk,
          title: planStep.title,
          description: `Agent 请求执行 ${planStep.toolName}。`,
          parameterSummary: summarizeParameters(planStep.arguments ?? {}),
          ...(diff ? { diff } : {}),
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
        if (planStep.kind === 'respond' && planStep.summary) state.run.response = planStep.summary
        await this.persist(state)
        state.index += 1
        continue
      }

      if (state.toolCalls >= this.maxToolCalls) { await this.fail(state, 'TOOL_CALL_LIMIT', `工具调用超过上限 ${this.maxToolCalls}。`); return }
      const isValidation = planStep.kind === 'validate'
      await this.setStatus(state, isValidation ? 'validating' : 'executing')
      step.status = 'running'
      step.startedAt = new Date().toISOString()
      await this.persist(state)

      let result: ToolResult | undefined
      const resolvedArguments = this.resolveValue(planStep.arguments ?? {}, state.results) as Record<string, unknown>
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        state.toolCalls += 1
        const startedAt = new Date().toISOString()
        const call: ToolCall = {
          id: crypto.randomUUID(), runId: state.run.id, stepId: planStep.id, serverName: 'cpppilot-local-tools',
          toolName: planStep.toolName, risk, parameterSummary: summarizeParameters(resolvedArguments), status: 'running', startedAt
        }
        await this.options.store.saveToolCall(call)
        try {
          result = await this.withDeadline(state, signal => this.options.toolClient.call(planStep.toolName!, resolvedArguments, signal, async progress => {
            await this.timeline(state, 'progress', 'running', planStep.title, progress.message, planStep.id, {
              toolName: planStep.toolName,
              progress: progress.progress,
              ...(progress.total === undefined ? {} : { total: progress.total })
            })
          }))
          const finishedAt = new Date().toISOString()
          await this.options.store.saveToolCall({
            ...call,
            result,
            status: result.ok ? 'completed' : 'failed',
            finishedAt,
            durationMs: result.durationMs,
            ...(result.errorCode ? { errorCode: result.errorCode } : {})
          })
        } catch (error) {
          const finishedAt = new Date().toISOString()
          await this.options.store.saveToolCall({
            ...call,
            status: state.controller.signal.aborted ? 'cancelled' : 'failed',
            finishedAt,
            durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
            errorCode: state.controller.signal.aborted ? 'CANCELLED' : error instanceof RuntimeDeadlineError ? 'AGENT_TIMEOUT' : 'MCP_CALL_FAILED'
          })
          throw error
        }
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
      await this.persist(state)
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
    const validationSteps = state.run.steps.filter(step => step.kind === 'validate')
    state.run.validationSummary = validationSteps.map(step => step.summary).filter(Boolean).join('；') || '计划步骤已完成。'
    const validationTitle = validationSteps.length
      ? `验证成功条件：${validationSteps.map(step => step.title).join('、')}`
      : '验证成功条件'
    await this.timeline(state, 'validation', 'completed', validationTitle, state.run.validationSummary, undefined, {
      successCriteria: state.plan?.successCriteria ?? []
    })
    await this.setStatus(state, 'completed')
    state.run.completedAt = state.run.updatedAt
    await this.persist(state)
    await this.timeline(state, 'response', 'completed', '完成回答', state.run.response)
  }

  private async fail(state: ExecutionState, code: string, message: string): Promise<void> {
    state.run.errorCode = code
    state.run.errorMessage = message
    state.run.response = `任务未完成：${message}`
    await this.setStatus(state, 'failed')
    state.run.completedAt = state.run.updatedAt
    await this.persist(state)
    await this.timeline(state, 'error', 'failed', '任务失败', message, undefined, { errorCode: code })
  }

  private async setStatus(state: ExecutionState, status: AgentRun['status']): Promise<void> {
    state.run.status = status
    state.run.updatedAt = new Date().toISOString()
    await this.persist(state)
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
    this.publish(state.run)
  }

  private async persist(state: ExecutionState): Promise<void> {
    await this.options.store.update(state.run)
    this.publish(state.run)
  }

  private publish(run: AgentRun): void {
    for (const listener of this.listeners) listener(structuredClone(run))
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

  private async withDeadline<T>(state: ExecutionState, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remaining = state.deadline - Date.now()
    if (remaining <= 0) throw new RuntimeDeadlineError()
    const timeoutController = new AbortController()
    const signal = AbortSignal.any([state.controller.signal, timeoutController.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const abort = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Agent operation aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => timeoutController.abort(new RuntimeDeadlineError()), remaining)
    })
    try {
      return await Promise.race([operation(signal), abort])
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
}

function summarizeParameters(value: Record<string, unknown>): Record<string, unknown> {
  const summarize = (item: unknown, depth: number): unknown => {
    if (depth > 4) return '[nested]'
    if (typeof item === 'string') return item.length > 500 ? `${item.slice(0, 500)}… (${item.length} chars)` : item
    if (Array.isArray(item)) return item.slice(0, 20).map(entry => summarize(entry, depth + 1))
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 50).map(([key, entry]) => [key, summarize(entry, depth + 1)]))
    return item
  }
  return summarize(value, 0) as Record<string, unknown>
}

function createPatchApprovalDiff(step: RuntimePlanStep, context?: ContextPacket): string | undefined {
  if (step.toolName !== 'workspace.apply_patch') return undefined
  const relativePath = typeof step.arguments?.relativePath === 'string' ? step.arguments.relativePath : undefined
  const proposed = typeof step.arguments?.content === 'string' ? step.arguments.content : undefined
  const current = context?.sources.find(source => source.kind === 'file' && (!relativePath || source.relativePath === relativePath))?.content
  if (current === undefined || proposed === undefined || current === proposed) return undefined
  return lineDiff(current, proposed, relativePath ?? 'file').slice(0, 100_000)
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
