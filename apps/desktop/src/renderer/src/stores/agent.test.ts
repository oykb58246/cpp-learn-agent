import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentRun, AgentRunDetail, LearnerSummary } from '@cpp-pet/contracts'
import { useAgentStore } from './agent'

const now = new Date().toISOString()
const run = (status: AgentRun['status']): AgentRun => ({
  id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main', mode: 'chat', message: '你好',
  status, steps: [], createdAt: now, updatedAt: now
})

describe('agent store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads H3 runs, learning data and model profiles', async () => {
    const completed = run('completed')
    const summary: LearnerSummary = {
      userId: 'local-user', xp: 20, level: 1, growthStage: 1, verifiedConcepts: 0,
      learningConcepts: 0, openErrors: 0, dueReviews: 0, achievements: [], recentEvents: []
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        agent: { list: async () => ({ ok: true, data: [completed] }), onChanged: () => () => undefined },
        learning: {
          catalog: async () => ({ ok: true, data: [] }), knowledge: async () => ({ ok: true, data: [] }), errors: async () => ({ ok: true, data: [] }),
          reviews: async () => ({ ok: true, data: [] }), summary: async () => ({ ok: true, data: summary })
        },
        model: { list: async () => ({ ok: true, data: [] }) }
      }
    } })
    const store = useAgentStore()

    await store.refreshAll()

    expect(store.runs).toEqual([completed])
    expect(store.summary?.xp).toBe(20)
    expect(store.loading).toBe(false)
  })

  it('updates the current run after start and approval', async () => {
    const waitingBase = run('waiting-approval')
    const waiting = { ...waitingBase, pendingApproval: {
      id: crypto.randomUUID(), runId: waitingBase.id, stepId: 'run', toolName: 'program.run', risk: 'L2' as const,
      title: '运行', description: '运行程序', parameterSummary: {}, sideEffects: ['run-program'], status: 'pending' as const, createdAt: now
    } }
    const completed = { ...waiting, status: 'completed' as const, pendingApproval: undefined }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        agent: { start: async () => ({ ok: true, data: waiting }), onChanged: () => () => undefined },
        approvals: { decide: async () => ({ ok: true, data: completed }) },
        learning: {
          knowledge: async () => ({ ok: true, data: [] }), errors: async () => ({ ok: true, data: [] }),
          reviews: async () => ({ ok: true, data: [] }), summary: async () => ({ ok: true, data: null })
        }
      }
    } })
    const store = useAgentStore()

    await store.start({ source: 'main', mode: 'chat', message: '运行' })
    expect(store.currentRun?.status).toBe('waiting-approval')
    await store.decide(waiting.pendingApproval.id, 'approved')
    expect(store.currentRun?.status).toBe('completed')
  })

  it('refreshes the active run detail when a streamed run event arrives', async () => {
    const active = run('executing')
    const detail: AgentRunDetail = {
      ...active,
      timeline: [{
        id: crypto.randomUUID(), runId: active.id, sequence: 0, kind: 'progress', status: 'running',
        title: '编译', summary: '50%', occurredAt: now, data: { progress: 50, total: 100 }
      }],
      approvals: [],
      toolCalls: []
    }
    let changed: ((value: AgentRun) => void) | undefined
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        agent: {
          onChanged(listener: (value: AgentRun) => void) { changed = listener; return () => undefined },
          get: async () => ({ ok: true, data: detail })
        }
      }
    } })
    const store = useAgentStore()
    store.currentRun = active
    store.subscribe()

    changed?.(active)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((store.currentRun as AgentRunDetail).timeline).toHaveLength(1)
  })

  it('clears a model key without removing the profile', async () => {
    const profile = {
      id: crypto.randomUUID(), name: 'Local gateway', baseUrl: 'https://models.example/v1', model: 'teacher',
      enabled: true, timeoutMs: 30_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { model: { clearKey: async () => ({ ok: true, data: { ...profile, apiKeyConfigured: false } }) } }
    } })
    const store = useAgentStore()
    store.models = [profile]

    await store.clearModelKey(profile.id)

    expect(store.models).toHaveLength(1)
    expect(store.models[0]?.apiKeyConfigured).toBe(false)
  })
})
