import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentRunDetail,
  BackgroundProfile,
  DiagnosticInboxChangedEvent,
  LearnerSummary
} from '@cpp-pet/contracts'
import { useAgentStore } from './agent'

const now = new Date().toISOString()
const run = (status: AgentRun['status']): AgentRun => ({
  id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main', mode: 'chat', message: '你好',
  status, steps: [], createdAt: now, updatedAt: now
})
const projectId = crypto.randomUUID()
const conversation = (id = crypto.randomUUID()): AgentConversation => ({
  id, projectId, title: '指针问题', status: 'active', createdAt: now, updatedAt: now
})
const message = (conversationId: string, role: AgentMessage['role'], content: string, status: AgentMessage['status'] = 'completed'): AgentMessage => ({
  id: crypto.randomUUID(), conversationId, role, kind: 'text', content, status,
  createdAt: now, updatedAt: now, ...(['completed', 'stopped', 'failed', 'interrupted'].includes(status) ? { completedAt: now } : {})
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


  it('selects an existing waiting model approval when loading a workspace conversation', async () => {
    const item = conversation()
    const approval = {
      id: crypto.randomUUID(), runId: crypto.randomUUID(), stepId: 'model-context', toolName: 'model.remote-context', risk: 'L3' as const,
      title: '发送上下文到 OpenAI 模型', description: '发送选区上下文', parameterSummary: {}, sideEffects: ['remote-request'], status: 'pending' as const, createdAt: now
    }
    const waiting: AgentRun = {
      id: approval.runId, requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: '解释选区',
      projectId, conversationId: item.id, assistantMessageId: crypto.randomUUID(), status: 'waiting-model-approval',
      pendingApproval: approval, steps: [], createdAt: now, updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        diagnostics: { listActive: async () => ({ ok: true, data: { projectId, groups: [], attention: false, updatedAt: now } }) },
        conversations: {
          list: async () => ({ ok: true, data: [item] }),
          messages: async () => ({ ok: true, data: [] })
        }
      }
    } })
    const store = useAgentStore()
    store.runs = [waiting]

    await store.loadProjectAgent(projectId)

    expect(store.currentConversationId).toBe(item.id)
    expect(store.currentRun?.id).toBe(waiting.id)
    expect(store.pendingApproval?.toolName).toBe('model.remote-context')
  })
  it('surfaces approvals for the current workspace conversation even when no run is selected', async () => {
    const conversationId = crypto.randomUUID()
    const approval = {
      id: crypto.randomUUID(), runId: crypto.randomUUID(), stepId: 'remote-context', toolName: 'model.remote-context', risk: 'L3' as const,
      title: '发送上下文到 OpenAI', description: '将当前选区上下文发送给模型', parameterSummary: {}, sideEffects: ['remote-request'], status: 'pending' as const, createdAt: now
    }
    const changedRun: AgentRun = {
      id: approval.runId, requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: '解释选区',
      projectId, conversationId, assistantMessageId: crypto.randomUUID(), status: 'waiting-model-approval',
      pendingApproval: approval, steps: [], createdAt: now, updatedAt: now
    }
    const detail: AgentRunDetail = { ...changedRun, timeline: [], approvals: [approval], toolCalls: [] }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { agent: { get: async () => ({ ok: true, data: detail }) } }
    } })
    const store = useAgentStore()
    store.agentProjectId = projectId
    store.currentConversationId = conversationId
    store.currentRun = null

    await store.handleRunChanged(changedRun)

    expect((store.currentRun as AgentRunDetail | null)?.id).toBe(changedRun.id)
    expect(store.pendingApproval?.toolName).toBe('model.remote-context')
  })
  it('settles the current run when a terminal assistant message arrives before the run event', () => {
    const conversationId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const staleRun: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: '解释选区',
      projectId, conversationId, assistantMessageId, status: 'model-requesting', steps: [], createdAt: now, updatedAt: now
    }
    const failedMessage: AgentMessage = {
      id: assistantMessageId, conversationId, role: 'assistant', kind: 'text', content: 'OpenAI 请求失败，回答未完成。',
      status: 'failed', errorCode: 'MODEL_REQUEST_FAILED', errorMessage: 'OpenAI 请求失败',
      createdAt: now, updatedAt: now, completedAt: now
    }
    const store = useAgentStore()
    store.agentProjectId = projectId
    store.currentConversationId = conversationId
    store.currentRun = staleRun
    store.runs = [staleRun]
    store.messages = [{ ...failedMessage, content: '', status: 'pending', errorCode: undefined, errorMessage: undefined, completedAt: undefined }]

    store.handleConversationChanged({ kind: 'message', projectId, message: failedMessage })

    expect(store.messages[0]).toMatchObject({ status: 'failed', errorMessage: 'OpenAI 请求失败' })
    expect(store.currentRun?.status).toBe('failed')
    expect(store.runs[0]).toMatchObject({ id: staleRun.id, status: 'failed', errorCode: 'MODEL_REQUEST_FAILED' })
  })
  it('tracks terminal failures for the current workspace conversation and refreshes messages', async () => {
    const conversationId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const failed: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: '解释选区',
      projectId, conversationId, assistantMessageId, status: 'failed', errorCode: 'MODEL_REQUEST_FAILED',
      errorMessage: 'OpenAI 请求失败', steps: [], createdAt: now, updatedAt: now, completedAt: now
    }
    const detail: AgentRunDetail = { ...failed, timeline: [], approvals: [], toolCalls: [] }
    const updatedAssistant: AgentMessage = {
      id: assistantMessageId, conversationId, role: 'assistant', kind: 'text', content: '任务未能完成。',
      status: 'failed', errorCode: 'MODEL_REQUEST_FAILED', errorMessage: 'OpenAI 请求失败',
      createdAt: now, updatedAt: now, completedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        agent: { get: async () => ({ ok: true, data: detail }) },
        conversations: { messages: async () => ({ ok: true, data: [updatedAssistant] }) }
      }
    } })
    const store = useAgentStore()
    store.agentProjectId = projectId
    store.currentConversationId = conversationId
    store.currentRun = {
      ...failed,
      status: 'model-requesting',
      errorCode: undefined,
      errorMessage: undefined,
      completedAt: undefined
    }
    store.messages = [{ ...updatedAssistant, content: '', status: 'pending', errorCode: undefined, errorMessage: undefined, completedAt: undefined }]

    await store.handleRunChanged(failed)

    expect(store.currentRun?.status).toBe('failed')
    expect(store.currentRun?.errorCode).toBe('MODEL_REQUEST_FAILED')
    expect(store.messages[0]).toMatchObject({ status: 'failed', errorMessage: 'OpenAI 请求失败' })
  })
  it('clears a model key without removing the profile', async () => {
    const profile = {
      id: crypto.randomUUID(), name: 'Local gateway', baseUrl: 'https://models.example/v1', model: 'teacher',
      provider: 'custom' as const, protocol: 'auto' as const,
      capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
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

  it('synchronizes the declared vision capability with the real image test result', async () => {
    const profile = {
      id: crypto.randomUUID(), name: 'Vision candidate', baseUrl: 'https://models.example/v1', model: 'teacher',
      provider: 'custom' as const, protocol: 'openai-responses' as const,
      capabilities: { text: true, vision: true, toolCalling: true, structuredOutput: true },
      enabled: true, timeoutMs: 30_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        model: {
          testVision: async () => ({
            ok: true,
            data: {
              supported: false,
              latencyMs: 12,
              detail: '服务拒绝了图片输入。',
              protocol: 'openai-responses' as const
            }
          })
        }
      }
    } })
    const store = useAgentStore()
    store.models = [profile]

    await store.testModelVision(profile.id)

    expect(store.models[0]?.capabilities.vision).toBe(false)
  })

  it('keeps one enabled model in memory after switching profiles', async () => {
    const first = {
      id: crypto.randomUUID(), name: 'First', baseUrl: 'https://first.example/v1', model: 'model-a',
      provider: 'custom' as const, protocol: 'auto' as const,
      capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
      enabled: true, timeoutMs: 30_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    const second = {
      id: crypto.randomUUID(), name: 'Second', baseUrl: 'https://second.example/v1', model: 'model-b',
      provider: 'custom' as const, protocol: 'auto' as const,
      capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
      enabled: false, timeoutMs: 30_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { model: { save: async () => ({ ok: true, data: { ...second, enabled: true } }) } }
    } })
    const store = useAgentStore()
    store.models = [first, second]

    await store.saveModel({ ...second, enabled: true })

    expect(store.models.filter(profile => profile.enabled).map(profile => profile.id)).toEqual([second.id])
  })

  it('stores the self-reported background used by assistant explanations', async () => {
    const profile: BackgroundProfile = {
      userId: 'local-user', onboardingCompleted: true, startingPoint: 'some-experience',
      studiedConceptIds: ['basics.program'], focusConceptIds: ['control.loops'], updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { learning: { saveBackground: async () => ({ ok: true, data: profile }) } }
    } })
    const store = useAgentStore()

    await store.saveBackground({
      onboardingCompleted: true,
      startingPoint: 'some-experience',
      studiedConceptIds: ['basics.program'],
      focusConceptIds: ['control.loops']
    })

    expect(store.background).toEqual(profile)
  })

  it('loads project-scoped inbox and the current conversation, then clears them on project switch', async () => {
    const first = conversation()
    const stored = [message(first.id, 'user', '为什么报错？')]
    const inbox: DiagnosticInboxChangedEvent = { projectId, groups: [], attention: false }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        diagnostics: { listActive: async () => ({ ok: true, data: inbox }) },
        conversations: {
          list: async ({ projectId: requested }: { projectId: string }) => ({ ok: true, data: requested === projectId ? [first] : [] }),
          messages: async () => ({ ok: true, data: stored })
        }
      }
    } })
    const store = useAgentStore()

    await store.loadProjectAgent(projectId)
    expect(store.currentConversationId).toBe(first.id)
    expect(store.messages).toEqual(stored)

    const otherProjectId = crypto.randomUUID()
    await store.loadProjectAgent(otherProjectId)
    expect(store.agentProjectId).toBe(otherProjectId)
    expect(store.currentConversationId).toBeNull()
    expect(store.messages).toEqual([])
  })

  it('submits a unified Agent task and links its run to the current conversation', async () => {
    const item = conversation()
    const user = message(item.id, 'user', '帮我写一个 hello world 程序')
    const assistant = message(item.id, 'assistant', '', 'pending')
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto',
      message: user.content, projectId, conversationId: item.id, assistantMessageId: assistant.id,
      status: 'waiting-approval', steps: [], createdAt: now, updatedAt: now
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { conversations: { submitAgent: async () => ({ ok: true, data: { user, assistant, run } }) } }
    } })
    const store = useAgentStore()
    store.agentProjectId = projectId
    store.currentConversationId = item.id

    await store.submitAgent({ message: user.content, activeFile: 'main.cpp' })

    expect(store.messages).toEqual([user, assistant])
    expect(store.currentRun).toEqual(run)
    expect(store.runs).toEqual([run])
  })

  it('continues the current waiting-input run through preload', async () => {
    const waiting: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main', mode: 'auto', message: '帮我改一下',
      status: 'waiting-input', pendingClarification: { question: '哪个文件？', requestedAt: now },
      steps: [], createdAt: now, updatedAt: now
    }
    const completed = { ...waiting, status: 'completed' as const, response: '已完成', pendingClarification: undefined }
    let received: unknown
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: { agent: { continue: async (input: unknown) => { received = input; return { ok: true, data: completed } } } }
    } })
    const store = useAgentStore()
    store.currentRun = waiting

    const result = await store.continue(waiting.id, 'main.cpp')

    expect(received).toEqual({ runId: waiting.id, message: 'main.cpp' })
    expect(result?.status).toBe('completed')
    expect(store.currentRun?.status).toBe('completed')
  })
})
