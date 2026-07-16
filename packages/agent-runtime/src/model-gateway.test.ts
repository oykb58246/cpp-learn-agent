import { describe, expect, it, vi } from 'vitest'
import type { ContextPacket, ModelProfile } from '@cpp-pet/contracts'
import {
  DeterministicPlanner,
  OpenAiCompatiblePlanner,
  ResilientPlanner,
  type RuntimePlanner
} from './model-gateway'

const request = {
  requestId: crypto.randomUUID(),
  source: 'editor' as const,
  mode: 'diagnose' as const,
  message: '解释错误',
  projectId: crypto.randomUUID(),
  activeFile: 'main.cpp'
}
const context: ContextPacket = { requestId: request.requestId, sources: [], conceptIds: ['control.loops'], tokenEstimate: 0, truncated: false }
const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'Local', baseUrl: 'https://models.example/v1', model: 'teacher-model',
  enabled: true, timeoutMs: 5_000, apiKeyConfigured: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}

describe('model planning gateway', () => {
  it('parses a schema-valid OpenAI-compatible plan', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'diagnose-compile-error', conceptIds: ['control.loops'], successCriteria: ['build succeeds'],
        steps: [{ id: 'build', title: '编译', kind: 'tool', toolName: 'compiler.build', risk: 'L1', arguments: {} }]
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const planner = new OpenAiCompatiblePlanner({ profile, apiKey: 'secret-key', fetcher })

    const plan = await planner.plan(request, context, new AbortController().signal)

    expect(plan).toMatchObject({ intent: 'diagnose-compile-error', source: 'model' })
    expect(fetcher).toHaveBeenCalledWith('https://models.example/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-key' })
    }))
    expect(JSON.stringify(plan)).not.toContain('secret-key')
  })

  it('falls back to deterministic planning when the model fails', async () => {
    const failing: RuntimePlanner = { async plan() { throw new Error('network unavailable') } }
    const planner = new ResilientPlanner(failing, new DeterministicPlanner())

    const plan = await planner.plan(request, context, new AbortController().signal)

    expect(plan.source).toBe('offline')
    expect(plan.fallbackReason).toContain('network unavailable')
    expect(plan.steps.map(step => step.toolName)).toContain('compiler.build')
  })

  it('rejects model output that references an unregistered tool', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'unsafe', conceptIds: [], successCriteria: [],
        steps: [{ id: 'shell', title: 'Shell', kind: 'tool', toolName: 'shell.exec', risk: 'L3', arguments: {} }]
      }) } }]
    }), { status: 200 })
    const planner = new OpenAiCompatiblePlanner({ profile, apiKey: 'secret-key', fetcher })

    await expect(planner.plan(request, context, new AbortController().signal)).rejects.toThrow('unregistered tool')
  })
})
