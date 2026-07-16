import { describe, expect, it } from 'vitest'
import type { AgentRun, AgentStartRequest, ContextPacket, ToolResult } from '@cpp-pet/contracts'
import { AgentRuntime, InMemoryRuntimeStore, type RuntimePlan } from '@cpp-pet/agent-runtime'
import { AgentHost } from './agent-host'

const success: ToolResult = {
  ok: true, exitCode: 0, summary: '完成', diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1
}

describe('AgentHost', () => {
  it('starts runs and publishes typed run changes', async () => {
    const store = new InMemoryRuntimeStore()
    const plan: RuntimePlan = {
      intent: 'chat', conceptIds: [], successCriteria: [],
      steps: [{ id: 'respond', title: '回答', kind: 'respond' }]
    }
    const changed: AgentRun[] = []
    const runtime = new AgentRuntime({
      store,
      contextBuilder: { async build(request): Promise<ContextPacket> { return { requestId: request.requestId, sources: [], conceptIds: [], tokenEstimate: 0, truncated: false } } },
      planner: { async plan() { return plan } },
      toolClient: { async call() { return success } },
      knowledgeGate: { check: () => ({ decision: 'allow', allowed: [], blocked: [], suggestedConceptIds: [], explanation: 'ok' }) }
    })
    const host = new AgentHost(runtime)
    const unsubscribe = host.onChanged(run => changed.push(run))
    const request: AgentStartRequest = { requestId: crypto.randomUUID(), source: 'main', mode: 'chat', message: '你好' }

    const run = await host.start(request)

    expect(run.status).toBe('completed')
    expect(host.get(run.id)?.id).toBe(run.id)
    expect(changed.at(-1)?.status).toBe('completed')
    expect(changed.map(item => item.status)).toEqual(expect.arrayContaining(['queued', 'contextualizing', 'planning', 'responding', 'completed']))
    unsubscribe()
  })
})
