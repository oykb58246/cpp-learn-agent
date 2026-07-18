import { defineStore } from 'pinia'
import type {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentRunDetail,
  AgentStartRequest,
  AppError,
  BackgroundProfile,
  BackgroundProfileInput,
  ConversationChangedEvent,
  ConversationSendInput,
  DiagnosticInboxChangedEvent,
  ErrorBookEntry,
  KnowledgeNode,
  LearnerKnowledge,
  LearnerSummary,
  ModelProfile,
  ModelProfileInput,
  ReviewItem
} from '@cpp-pet/contracts'

export const useAgentStore = defineStore('agent', {
  state: () => ({
    runs: [] as AgentRun[],
    currentRun: null as AgentRunDetail | AgentRun | null,
    catalog: [] as KnowledgeNode[],
    knowledge: [] as LearnerKnowledge[],
    background: null as BackgroundProfile | null,
    errors: [] as ErrorBookEntry[],
    reviews: [] as ReviewItem[],
    summary: null as LearnerSummary | null,
    models: [] as ModelProfile[],
    agentProjectId: null as string | null,
    inbox: null as DiagnosticInboxChangedEvent | null,
    conversations: [] as AgentConversation[],
    currentConversationId: null as string | null,
    messages: [] as AgentMessage[],
    conversationLoading: false,
    agentLoadGeneration: 0,
    loading: false,
    running: false,
    error: null as AppError | null,
    unsubscribe: null as (() => void) | null,
    conversationUnsubscribes: [] as Array<() => void>
  }),
  getters: {
    pendingApproval: state => state.currentRun?.pendingApproval,
    dueReviews: state => state.reviews.filter(item => item.status === 'pending' && item.dueAt <= new Date().toISOString()),
    openErrors: state => state.errors.filter(item => item.status !== 'resolved')
  },
  actions: {
    async refreshAll() {
      this.loading = true
      this.error = null
      const [runs, catalog, knowledge, errors, reviews, summary, models] = await Promise.all([
        window.cppPet.agent.list({ limit: 100 }),
        window.cppPet.learning.catalog(),
        window.cppPet.learning.knowledge(),
        window.cppPet.learning.errors(),
        window.cppPet.learning.reviews(),
        window.cppPet.learning.summary(),
        window.cppPet.model.list()
      ])
      if (runs.ok) this.runs = runs.data; else this.error = runs.error
      if (catalog.ok) this.catalog = catalog.data; else this.error ??= catalog.error
      if (knowledge.ok) this.knowledge = knowledge.data; else this.error ??= knowledge.error
      if (errors.ok) this.errors = errors.data; else this.error ??= errors.error
      if (reviews.ok) this.reviews = reviews.data; else this.error ??= reviews.error
      if (summary.ok) this.summary = summary.data; else this.error ??= summary.error
      if (models.ok) this.models = models.data; else this.error ??= models.error
      this.loading = false
    },
    subscribe() {
      if (this.unsubscribe) return
      this.unsubscribe = window.cppPet.agent.onChanged(run => { void this.handleRunChanged(run) })
      if (window.cppPet.diagnostics?.onChanged) {
        this.conversationUnsubscribes.push(window.cppPet.diagnostics.onChanged(event => this.handleInboxChanged(event)))
      }
      if (window.cppPet.conversations?.onChanged) {
        this.conversationUnsubscribes.push(window.cppPet.conversations.onChanged(event => this.handleConversationChanged(event)))
      }
    },
    dispose() {
      this.unsubscribe?.()
      this.unsubscribe = null
      for (const unsubscribe of this.conversationUnsubscribes.splice(0)) unsubscribe()
    },
    async loadProjectAgent(projectId: string) {
      const generation = ++this.agentLoadGeneration
      this.agentProjectId = projectId
      this.inbox = null
      this.conversations = []
      this.currentConversationId = null
      this.messages = []
      this.conversationLoading = true
      this.error = null
      const [inbox, conversations] = await Promise.all([
        window.cppPet.diagnostics.listActive({ projectId }),
        window.cppPet.conversations.list({ projectId })
      ])
      if (generation !== this.agentLoadGeneration || this.agentProjectId !== projectId) return
      if (inbox.ok) this.inbox = inbox.data
      else this.error = inbox.error
      if (!conversations.ok) {
        this.error ??= conversations.error
        this.conversationLoading = false
        return
      }
      this.conversations = conversations.data
      const current = conversations.data[0]
      if (current) await this.selectConversation(current.id, generation)
      if (generation === this.agentLoadGeneration) this.conversationLoading = false
    },
    async createConversation(title?: string) {
      const projectId = this.agentProjectId
      if (!projectId) return null
      const result = await window.cppPet.conversations.create({ projectId, ...(title ? { title } : {}) })
      if (!result.ok) { this.error = result.error; return null }
      this.upsertConversation(result.data)
      this.currentConversationId = result.data.id
      this.messages = []
      return result.data
    },
    async selectConversation(conversationId: string, generation?: number) {
      const projectId = this.agentProjectId
      if (!projectId) return null
      const loadGeneration = generation ?? this.agentLoadGeneration
      this.conversationLoading = true
      const result = await window.cppPet.conversations.messages({ projectId, conversationId })
      if (loadGeneration !== this.agentLoadGeneration || this.agentProjectId !== projectId) return null
      this.conversationLoading = false
      if (!result.ok) { this.error = result.error; return null }
      this.currentConversationId = conversationId
      this.messages = result.data
      return result.data
    },
    async submitAgent(input: Omit<ConversationSendInput, 'projectId' | 'conversationId'>) {
      const projectId = this.agentProjectId
      if (!projectId) return null
      if (!this.currentConversationId && !await this.createConversation()) return null
      const conversationId = this.currentConversationId
      if (!conversationId) return null
      this.running = true
      this.error = null
      const result = await window.cppPet.conversations.submitAgent({ ...input, projectId, conversationId })
      this.running = false
      if (!result.ok) { this.error = result.error; return null }
      this.upsertMessage(result.data.user)
      this.upsertMessage(result.data.assistant)
      this.upsertRun(result.data.run)
      this.currentRun = result.data.run
      const [detail, messages] = await Promise.all([
        typeof window.cppPet.agent?.get === 'function' ? window.cppPet.agent.get({ runId: result.data.run.id }) : Promise.resolve(null),
        typeof window.cppPet.conversations.messages === 'function' ? window.cppPet.conversations.messages({ projectId, conversationId }) : Promise.resolve(null)
      ])
      if (detail?.ok) {
        this.currentRun = detail.data
        this.upsertRun(detail.data)
      } else if (detail) this.error ??= detail.error
      if (messages?.ok) this.messages = messages.data
      else if (messages) this.error ??= messages.error
      return result.data
    },
    async acknowledgeInbox() {
      const projectId = this.agentProjectId
      if (!projectId) return null
      const result = await window.cppPet.diagnostics.acknowledge({ projectId })
      if (!result.ok) { this.error = result.error; return null }
      if (this.agentProjectId === projectId) this.inbox = result.data
      return result.data
    },
    handleInboxChanged(event: DiagnosticInboxChangedEvent) {
      if (event.projectId === this.agentProjectId) this.inbox = event
    },
    handleConversationChanged(event: ConversationChangedEvent) {
      if (event.projectId !== this.agentProjectId) return
      if (event.kind === 'conversation') {
        if (event.conversation.status === 'archived') {
          this.conversations = this.conversations.filter(item => item.id !== event.conversation.id)
        } else this.upsertConversation(event.conversation)
        return
      }
      if (event.message.conversationId === this.currentConversationId) this.upsertMessage(event.message)
    },
    upsertConversation(conversation: AgentConversation) {
      const index = this.conversations.findIndex(item => item.id === conversation.id)
      if (index >= 0) this.conversations[index] = conversation
      else this.conversations.unshift(conversation)
    },
    upsertMessage(message: AgentMessage) {
      const index = this.messages.findIndex(item => item.id === message.id)
      if (index >= 0) this.messages[index] = message
      else this.messages.push(message)
    },
    async start(input: AgentStartRequest) {
      this.running = true
      this.error = null
      const result = await window.cppPet.agent.start(input)
      this.running = false
      if (!result.ok) { this.error = result.error; return null }
      this.upsertRun(result.data)
      this.currentRun = result.data
      return result.data
    },
    async selectRun(runId: string) {
      const result = await window.cppPet.agent.get({ runId })
      if (!result.ok) { this.error = result.error; return null }
      this.currentRun = result.data
      this.upsertRun(result.data)
      return result.data
    },
    async decide(approvalId: string, decision: 'approved' | 'rejected', reason?: string) {
      const result = await window.cppPet.approvals.decide({ approvalId, decision, ...(reason ? { reason } : {}) })
      if (!result.ok) { this.error = result.error; return null }
      this.upsertRun(result.data)
      this.currentRun = result.data
      await this.refreshLearning()
      return result.data
    },
    async cancel(runId: string) {
      const result = await window.cppPet.agent.cancel({ runId })
      if (!result.ok) { this.error = result.error; return null }
      this.upsertRun(result.data)
      this.currentRun = result.data
      return result.data
    },
    async updateKnowledge(conceptId: string, status: LearnerKnowledge['status']) {
      const result = await window.cppPet.learning.updateKnowledge({ conceptId, status })
      if (!result.ok) { this.error = result.error; return null }
      const index = this.knowledge.findIndex(item => item.conceptId === conceptId)
      if (index >= 0) this.knowledge[index] = result.data
      else this.knowledge.push(result.data)
      return result.data
    },
    async loadBackground() {
      const result = await window.cppPet.learning.background({ userId: 'local-user' })
      if (!result.ok) { this.error = result.error; return null }
      this.background = result.data
      return result.data
    },
    async saveBackground(input: BackgroundProfileInput) {
      const result = await window.cppPet.learning.saveBackground(input)
      if (!result.ok) { this.error = result.error; return null }
      this.background = result.data
      return result.data
    },
    async saveModel(input: ModelProfileInput) {
      const result = await window.cppPet.model.save(input)
      if (!result.ok) { this.error = result.error; return null }
      const index = this.models.findIndex(item => item.id === result.data.id)
      if (index >= 0) this.models[index] = result.data
      else this.models.unshift(result.data)
      return result.data
    },
    async removeModel(profileId: string) {
      const result = await window.cppPet.model.remove({ profileId })
      if (!result.ok) { this.error = result.error; return false }
      this.models = this.models.filter(item => item.id !== profileId)
      return true
    },
    async clearModelKey(profileId: string) {
      const result = await window.cppPet.model.clearKey({ profileId })
      if (!result.ok) { this.error = result.error; return null }
      const index = this.models.findIndex(item => item.id === profileId)
      if (index >= 0) this.models[index] = result.data
      else this.models.unshift(result.data)
      return result.data
    },
    async testModel(profileId: string) {
      const result = await window.cppPet.model.test({ profileId })
      if (!result.ok) { this.error = result.error; return null }
      return result.data
    },
    async refreshModels() {
      const result = await window.cppPet.model.list()
      if (!result.ok) { this.error = result.error; return }
      this.models = result.data
    },
    async refreshLearning() {
      const [knowledge, errors, reviews, summary] = await Promise.all([
        window.cppPet.learning.knowledge(), window.cppPet.learning.errors(),
        window.cppPet.learning.reviews(), window.cppPet.learning.summary()
      ])
      if (knowledge.ok) this.knowledge = knowledge.data
      if (errors.ok) this.errors = errors.data
      if (reviews.ok) this.reviews = reviews.data
      if (summary.ok) this.summary = summary.data
    },
    async handleRunChanged(run: AgentRun) {
      this.upsertRun(run)
      if (this.currentRun?.id !== run.id) return
      const detail = await window.cppPet.agent.get({ runId: run.id })
      if (!detail.ok) { this.error = detail.error; return }
      if (this.currentRun?.id === run.id) this.currentRun = detail.data
      this.upsertRun(detail.data)
    },
    upsertRun(run: AgentRun) {
      const index = this.runs.findIndex(item => item.id === run.id)
      if (index >= 0) this.runs[index] = run
      else this.runs.unshift(run)
      if (this.currentRun?.id === run.id) this.currentRun = { ...this.currentRun, ...run }
    }
  }
})
