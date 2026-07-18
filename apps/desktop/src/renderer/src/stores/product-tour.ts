import { defineStore } from 'pinia'
import type { AppSettings } from '@cpp-pet/contracts'
import { beginnerTourSteps } from '../utils/product-tour'
import { useAppStore } from './app'

function normalizeStep(step: number) {
  return Math.min(Math.max(0, Math.trunc(step)), beginnerTourSteps.length - 1)
}

export const useProductTourStore = defineStore('product-tour', {
  state: () => ({
    open: false,
    replaying: false,
    replayStep: 0,
    locating: false,
    agentRunId: ''
  }),
  getters: {
    currentStepIndex(state) {
      return state.replaying
        ? normalizeStep(state.replayStep)
        : normalizeStep(useAppStore().settings.productTourStep)
    }
  },
  actions: {
    async persist(patch: Partial<AppSettings>) {
      const saved = await useAppStore().updateSettings(patch)
      if (!saved) this.open = false
      return saved
    },
    async start() {
      this.replaying = false
      this.replayStep = 0
      this.agentRunId = ''
      this.open = await this.persist({
        productTourStatus: 'in-progress',
        productTourStep: 0,
        productTourWelcomeSeen: true
      })
    },
    resume() {
      this.replaying = false
      this.open = true
    },
    pause() {
      this.open = false
    },
    trackAgentRun(runId: string) {
      this.agentRunId = runId
    },
    async markWelcomeSeen() {
      return this.persist({ productTourWelcomeSeen: true })
    },
    async dismiss() {
      await this.persist({ productTourStatus: 'dismissed', productTourWelcomeSeen: true })
      this.open = false
      this.replaying = false
    },
    async goTo(step: number) {
      const next = normalizeStep(step)
      if (this.replaying) {
        this.replayStep = next
        this.open = true
        return
      }
      this.open = await this.persist({ productTourStep: next })
    },
    async complete() {
      if (!this.replaying) {
        await this.persist({
          productTourStatus: 'completed',
          productTourStep: beginnerTourSteps.length - 1,
          productTourWelcomeSeen: true
        })
      }
      this.open = false
      this.replaying = false
    },
    replay() {
      this.replaying = true
      this.replayStep = 0
      this.agentRunId = ''
      this.open = true
    }
  }
})
