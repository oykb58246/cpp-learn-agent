import { defineStore } from 'pinia'
import type {
  AgentRun,
  AgentRunDetail,
  AgentStartRequest,
  AppError,
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
    errors: [] as ErrorBookEntry[],
    reviews: [] as ReviewItem[],
    summary: null as LearnerSummary | null,
    models: [] as ModelProfile[],
    loading: false,
    running: false,
    error: null as AppError | null,
    unsubscribe: null as (() => void) | null
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
    },
    dispose() {
      this.unsubscribe?.()
      this.unsubscribe = null
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
