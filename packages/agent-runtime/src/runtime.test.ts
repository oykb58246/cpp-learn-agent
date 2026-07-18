import { describe, expect, it } from 'vitest'
import type {
  AgentExecutionEvidence,
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
  it('requires L3 approval before a remote planner receives sensitive context', async () => {
    let planCalls = 0
    const planner = {
      contextApproval() {
        return {
          risk: 'L3' as const,
          title: '发送最小上下文到模型服务',
          description: '将选区发送到已配置模型。',
          parameterSummary: { sources: ['selection'] },
          sideEffects: ['remote-request']
        }
      },
      async plan(): Promise<RuntimePlan> {
        planCalls += 1
        return {
          intent: 'explain-selection', conceptIds: [], successCriteria: ['answer'],
          steps: [{ id: 'respond', title: '回答', kind: 'respond', summary: '已获批准的回答。' }]
        }
      }
    }
    const store = new InMemoryRuntimeStore()
    const runtime = new AgentRuntime({ store, contextBuilder, planner, toolClient: { async call() { return success() } }, knowledgeGate: allowGate })

    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'explain' })

    expect(waiting).toMatchObject({ status: 'waiting-approval', pendingApproval: { risk: 'L3', toolName: 'model.remote-context' } })
    expect(planCalls).toBe(0)
    const completed = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' })
    expect(completed.status).toBe('completed')
    expect(planCalls).toBe(1)
  })

  it('does not call a remote planner after context approval is rejected', async () => {
    let planCalls = 0
    const planner = {
      contextApproval() { return { risk: 'L3' as const, title: '发送上下文', description: '远程请求', parameterSummary: {}, sideEffects: ['remote-request'] } },
      async plan(): Promise<RuntimePlan> { planCalls += 1; return { intent: 'chat', conceptIds: [], successCriteria: [], steps: [] } }
    }
    const runtime = new AgentRuntime({ store: new InMemoryRuntimeStore(), contextBuilder, planner, toolClient: { async call() { return success() } }, knowledgeGate: allowGate })
    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'explain' })

    const rejected = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'rejected' })

    expect(rejected.status).toBe('cancelled')
    expect(planCalls).toBe(0)
  })

  it('records structured MCP progress before the tool result', async () => {
    const { runtime, store } = createRuntime({
        intent: 'environment', conceptIds: [], successCriteria: ['检测完成'],
        steps: [{ id: 'detect', title: '检测工具链', kind: 'tool', toolName: 'toolchain.detect_compilers', risk: 'L0' }]
      }, {
        async call(_name, _args, _signal, onProgress?: (event: { progress: number; total?: number; message: string }) => void | Promise<void>) {
          await onProgress?.({ progress: 50, total: 100, message: '正在探测编译器' })
          return success()
        }
      })

    const run = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'environment' })
    const progress = store.get(run.id)?.timeline.find(event => event.kind === 'progress')

    expect(progress).toMatchObject({ status: 'running', summary: '正在探测编译器', data: { progress: 50, total: 100, toolName: 'toolchain.detect_compilers' } })
    expect(store.get(run.id)?.toolCalls).toMatchObject([{
      stepId: 'detect', serverName: 'cpppilot-local-tools', toolName: 'toolchain.detect_compilers', risk: 'L0', status: 'completed',
      result: { ok: true }
    }])
  })

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

  it('stores only a bounded parameter preview in approvals', async () => {
    const content = 'x'.repeat(2_000)
    const plan: RuntimePlan = {
      intent: 'patch', conceptIds: [], successCriteria: [],
      steps: [{ id: 'patch', title: '应用修改', kind: 'tool', toolName: 'workspace.apply_patch', risk: 'L2', arguments: { relativePath: 'main.cpp', content } }]
    }
    const { runtime } = createRuntime(plan, { async call() { return success() } })

    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID() })
    const serialized = JSON.stringify(waiting.pendingApproval?.parameterSummary)

    expect(serialized).not.toContain(content)
    expect(serialized).toContain('2000 chars')
  })

  it('attaches a bounded line diff to file patch approvals', async () => {
    const plan: RuntimePlan = {
      intent: 'patch', conceptIds: [], successCriteria: [],
      steps: [{
        id: 'patch', title: '应用修改', kind: 'tool', toolName: 'workspace.apply_patch', risk: 'L2',
        arguments: { relativePath: 'main.cpp', content: 'int main() {\n  return 1;\n}\n' }
      }]
    }
    const store = new InMemoryRuntimeStore()
    const runtime = new AgentRuntime({
      store,
      contextBuilder: {
        async build(input) {
          return {
            requestId: input.requestId!,
            sources: [{ kind: 'file', label: 'main.cpp', relativePath: 'main.cpp', content: 'int main() {\n  return 0;\n}\n', trusted: true }],
            conceptIds: [], tokenEstimate: 8, truncated: false
          }
        }
      },
      planner: { async plan() { return plan } },
      toolClient: { async call() { return success() } },
      knowledgeGate: allowGate
    })

    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID() })

    expect((waiting.pendingApproval as { diff?: string } | undefined)?.diff).toContain('-  return 0;')
    expect((waiting.pendingApproval as { diff?: string } | undefined)?.diff).toContain('+  return 1;')
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

  it('continues to execute when the requested concept is unfamiliar', async () => {
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
    expect(calls).toEqual(['workspace.read_file'])
    expect(store.get(run.id)?.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'policy', title: '讲解背景已应用' })
    ]))
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

  it('enforces the total deadline even when a tool ignores cancellation', async () => {
    const plan: RuntimePlan = {
      intent: 'long-tool', conceptIds: [], successCriteria: [],
      steps: [{ id: 'slow', title: '慢工具', kind: 'tool', toolName: 'compiler.build', risk: 'L1', arguments: {} }]
    }
    const store = new InMemoryRuntimeStore()
    const planner: RuntimePlanner = { async plan() { return plan } }
    const runtime = new AgentRuntime({
      store, contextBuilder, planner,
      toolClient: { async call() { await new Promise(resolve => setTimeout(resolve, 80)); return success() } },
      knowledgeGate: allowGate, totalTimeoutMs: 20
    })

    const run = await runtime.start({ ...request, requestId: crypto.randomUUID() })

    expect(run).toMatchObject({ status: 'failed', errorCode: 'AGENT_TIMEOUT' })
    expect(store.get(run.id)?.toolCalls[0]?.status).toBe('failed')
  })

  it('uses the approved respond step as the teaching answer', async () => {
    const plan: RuntimePlan = {
      intent: 'explain-selection', conceptIds: [], successCriteria: ['teaching response produced'],
      steps: [{ id: 'respond', title: '解释 return', kind: 'respond', summary: 'return 会结束当前函数并把结果交给调用者。' }]
    }
    const { runtime, store } = createRuntime(plan, { async call() { return success() } })

    const run = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'explain' })

    expect(run.response).toBe('return 会结束当前函数并把结果交给调用者。')
    expect(store.get(run.id)?.timeline.some(item => item.kind === 'response' && item.summary === run.response)).toBe(true)
    expect(store.get(run.id)?.timeline.map(item => item.kind)).not.toContain('learning')
  })

  it('uses execution evidence to generate the final model response', async () => {
    const plan: RuntimePlan = {
      intent: 'edit_code', conceptIds: ['basics.program'], successCriteria: ['build succeeds'], source: 'model',
      workflow: 'edit-and-build', responseGoal: '说明实际编译结果',
      steps: [{ id: 'build', title: '编译验证', kind: 'validate', toolName: 'compiler.build', risk: 'L1', arguments: {} }]
    }
    let receivedEvidence: AgentExecutionEvidence[] = []
    const planner: RuntimePlanner = {
      async plan() { return plan },
      async finalize(_request, _context, _plan, evidence) {
        receivedEvidence = evidence
        return '已经根据真实工具结果完成处理，编译通过。'
      }
    }
    const runtime = new AgentRuntime({
      store: new InMemoryRuntimeStore(), contextBuilder, planner,
      toolClient: { async call() { return success('GCC 编译通过') } }, knowledgeGate: allowGate
    })

    const run = await runtime.start({ ...request, requestId: crypto.randomUUID(), mode: 'auto' })

    expect(run.response).toContain('编译通过')
    expect(receivedEvidence).toEqual([expect.objectContaining({ stepId: 'build', tool: 'compiler.build', ok: true, summary: 'GCC 编译通过' })])
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

  it('cancels every pending run during runtime shutdown', async () => {
    const plan: RuntimePlan = {
      intent: 'write', conceptIds: [], successCriteria: [],
      steps: [{ id: 'write', title: '写入文件', kind: 'tool', toolName: 'workspace.create_file', risk: 'L2', arguments: {} }]
    }
    const { runtime, store } = createRuntime(plan, { async call() { return success() } })
    const waiting = await runtime.start({ ...request, requestId: crypto.randomUUID() })

    await runtime.shutdown()

    expect(store.get(waiting.id)).toMatchObject({ status: 'cancelled', response: '任务已取消。' })
    expect(store.get(waiting.id)?.timeline.at(-1)).toMatchObject({ kind: 'cancelled', status: 'cancelled' })
  })
})
