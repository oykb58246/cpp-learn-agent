import { describe, expect, it } from 'vitest'
import type { AgentRun, AgentStartRequest, ContextPacket, ToolResult } from '@cpp-pet/contracts'
import { AgentRuntime, InMemoryRuntimeStore, type AgentRuntimeController, type RuntimePlan } from '@cpp-pet/agent-runtime'
import { AgentHost } from './agent-host'

const success: ToolResult = {
  ok: true, exitCode: 0, summary: '完成', diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1
}

describe('AgentHost', () => {
  it('forwards clarification to a runtime controller', async () => {
    const run = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main' as const, mode: 'auto' as const,
      message: 'question', status: 'waiting-input' as const, steps: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    const controller: AgentRuntimeController = {
      onChanged: () => () => undefined,
      async start() { return run }, async continue(input) { return { ...run, response: input.message } },
      get: () => undefined, list: () => [run], async decide() { return run }, async cancel() { return run }, async shutdown() {}
    }
    const host = new AgentHost(controller)

    const continued = await host.continue({ runId: run.id, message: 'main.cpp' })

    expect(continued.response).toBe('main.cpp')
  })

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
