import { describe, expect, it } from 'vitest'
import type {
  AgentStartRequest,
  ContextPacket,
  KnowledgeGateResult,
  ToolResult
} from '@cpp-pet/contracts'
import {
  AgentRuntime,
  InMemoryRuntimeStore,
  type RuntimeContextBuilder,
  type RuntimePlan,
  type RuntimePlanner,
  type RuntimeToolClient
} from './runtime'

const request: AgentStartRequest = {
  requestId: crypto.randomUUID(),
  source: 'editor',
  mode: 'diagnose',
  message: '修复编译错误',
  projectId: crypto.randomUUID(),
  activeFile: 'main.cpp'
}

const contextBuilder: RuntimeContextBuilder = {
  async build(input): Promise<ContextPacket> {
    return { requestId: input.requestId!, sources: [], conceptIds: ['control.loops'], tokenEstimate: 0, truncated: false }
  }
}

const allowGate = {
  check(): KnowledgeGateResult {
    return { decision: 'allow', allowed: ['control.loops'], blocked: [], suggestedConceptIds: [], explanation: 'ok' }
  }
}

const success = (summary = '完成'): ToolResult => ({
  ok: true, exitCode: 0, summary, diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1
})

function createRuntime(plan: RuntimePlan, toolClient: RuntimeToolClient, store = new InMemoryRuntimeStore()) {
  const planner: RuntimePlanner = { async plan() { return plan } }
  return { runtime: new AgentRuntime({ store, contextBuilder, planner, toolClient, knowledgeGate: allowGate }), store }
}

describe('AgentRuntime', () => {
  it('pauses for L2 approval and resumes to a validated completion', async () => {
    const calls: string[] = []
    const toolClient: RuntimeToolClient = { async call(name) { calls.push(name); return success(name) } }
    const plan: RuntimePlan = {
      intent: 'diagnose-compile-error',
      conceptIds: ['control.loops'],
      successCriteria: ['rebuild succeeds'],
      steps: [
        { id: 'build', title: '编译', kind: 'tool', toolName: 'compiler.build', risk: 'L1', arguments: {} },
        { id: 'patch', title: '应用修改', kind: 'tool', toolName: 'workspace.apply_patch', risk: 'L2', arguments: { relativePath: 'main.cpp' }, sideEffects: ['write-file'] },
        { id: 'verify', title: '重新编译', kind: 'validate', toolName: 'compiler.build', risk: 'L1', arguments: {} }
      ]
    }
    const { runtime, store } = createRuntime(plan, toolClient)

    const waiting = await runtime.start(request)
    expect(waiting.status).toBe('waiting-approval')
    expect(waiting.pendingApproval?.toolName).toBe('workspace.apply_patch')
    expect(calls).toEqual(['compiler.build'])

    const completed = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' })
    expect(completed.status).toBe('completed')
    expect(calls).toEqual(['compiler.build', 'workspace.apply_patch', 'compiler.build'])
    expect(store.get(completed.id)?.timeline.map(event => event.kind)).toEqual(expect.arrayContaining(['intent', 'plan', 'approval', 'tool', 'validation', 'response']))
  })

  it('does not invoke a rejected tool', async () => {
    const calls: string[] = []
    const plan: RuntimePlan = {
      intent: 'run-program', conceptIds: [], successCriteria: [],
      steps: [{ id: 'run', title: '运行', kind: 'tool', toolName: 'program.run', risk: 'L2', arguments: {}, sideEffects: ['run-program'] }]
    }
    const { runtime } = createRuntime(plan, { async call(name) { calls.push(name); return success() } })
    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID() })
    const rejected = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'rejected', reason: '暂不运行' })

    expect(rejected.status).toBe('cancelled')
    expect(calls).toEqual([])
  })

  it('stops before tools when the knowledge gate requires learning', async () => {
    const calls: string[] = []
    const plan: RuntimePlan = {
      intent: 'explain-vector', conceptIds: ['stl.vector'], successCriteria: [],
      steps: [{ id: 'read', title: '读取', kind: 'tool', toolName: 'workspace.read_file', risk: 'L0', arguments: {} }]
    }
    const store = new InMemoryRuntimeStore()
    const runtime = new AgentRuntime({
      store,
      contextBuilder,
      planner: { async plan() { return plan } },
      toolClient: { async call(name) { calls.push(name); return success() } },
      knowledgeGate: {
        check(): KnowledgeGateResult {
          return { decision: 'learn', allowed: [], blocked: ['stl.vector'], suggestedConceptIds: ['generic.templates'], explanation: '先学习模板' }
        }
      }
    })
    const run = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'explain' })

    expect(run.status).toBe('completed')
    expect(run.response).toContain('先学习模板')
    expect(calls).toEqual([])
  })

  it('retries one retryable tool failure', async () => {
    let attempts = 0
    const plan: RuntimePlan = {
      intent: 'build', conceptIds: [], successCriteria: [],
      steps: [{ id: 'build', title: '编译', kind: 'tool', toolName: 'compiler.build', risk: 'L1', arguments: {} }]
    }
    const { runtime } = createRuntime(plan, {
      async call() {
        attempts += 1
        return attempts === 1
          ? { ...success(), ok: false, retryable: true, errorCode: 'TEMPORARY', summary: '暂时失败' }
          : success()
      }
    })
    const run = await runtime.start({ ...request, requestId: crypto.randomUUID() })
    expect(run.status).toBe('completed')
    expect(attempts).toBe(2)
  })

  it('rejects plans beyond the configured step limit', async () => {
    const plan: RuntimePlan = {
      intent: 'too-long', conceptIds: [], successCriteria: [],
      steps: Array.from({ length: 13 }, (_, index) => ({ id: `s${index}`, title: '步骤', kind: 'reason' as const }))
    }
    const { runtime } = createRuntime(plan, { async call() { return success() } })
    const run = await runtime.start({ ...request, requestId: crypto.randomUUID() })
    expect(run).toMatchObject({ status: 'failed', errorCode: 'PLAN_STEP_LIMIT' })
  })

  it('cancels an active tool through AbortSignal', async () => {
    const plan: RuntimePlan = {
      intent: 'long-run', conceptIds: [], successCriteria: [],
      steps: [{ id: 'run', title: '运行', kind: 'tool', toolName: 'program.run', risk: 'L1', arguments: {} }]
    }
    let started!: () => void
    const startedPromise = new Promise<void>(resolve => { started = resolve })
    const { runtime } = createRuntime(plan, {
      async call(_name, _args, signal) {
        started()
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { ...success(), ok: false, errorCode: 'CANCELLED', summary: '已取消' }
      }
    })
    const startPromise = runtime.start({ ...request, requestId: crypto.randomUUID() })
    await startedPromise
    const active = runtime.list()[0]!
    const cancelled = await runtime.cancel(active.id)
    await startPromise
    expect(cancelled.status).toBe('cancelled')
  })
})
