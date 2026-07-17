import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AppSettings } from '@cpp-pet/contracts'
import { useAppStore } from './app'
import { useProductTourStore } from './product-tour'

const baseSettings = (): AppSettings => ({
  theme: 'system',
  sidebarWidth: 260,
  inspectorWidth: 320,
  bottomPanelHeight: 190,
  cursorStyle: 'mascot',
  onboardingCompleted: true,
  onboardingStatus: 'completed',
  onboardingReminderDismissed: false,
  productTourStatus: 'pending',
  productTourStep: 0,
  productTourWelcomeSeen: false
})

function prepareApp(settingsUpdate?: (patch: Partial<AppSettings>, current: AppSettings) => Promise<any>) {
  let current = baseSettings()
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false })
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: {
      classList: { toggle: () => undefined },
      dataset: {},
      style: { setProperty: () => undefined, removeProperty: () => undefined }
    } }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { cppPet: { settings: { update: async (patch: Partial<AppSettings>) => {
      if (settingsUpdate) return settingsUpdate(patch, current)
      current = { ...current, ...patch }
      return { ok: true, data: current }
    } } } }
  })
  const app = useAppStore()
  app.bootstrap = {
    version: 'test',
    platform: 'win32',
    recoveryMode: false,
    settings: current,
    recentProjects: [],
    workspaces: [],
    recentEvents: []
  }
  return app
}

describe('product tour store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('persists start, navigation, pause, and completion', async () => {
    const app = prepareApp()
    const tour = useProductTourStore()

    await tour.start()
    expect(tour.open).toBe(true)
    expect(app.settings).toMatchObject({ productTourStatus: 'in-progress', productTourStep: 0, productTourWelcomeSeen: true })

    await tour.goTo(3)
    expect(tour.currentStepIndex).toBe(3)
    expect(app.settings.productTourStep).toBe(3)
    tour.pause()
    expect(tour.open).toBe(false)
    expect(app.settings.productTourStatus).toBe('in-progress')

    await tour.complete()
    expect(tour.open).toBe(false)
    expect(app.settings.productTourStatus).toBe('completed')
    expect(app.settings.productTourStep).toBe(5)
  })

  it('replays without replacing persisted completion', async () => {
    const app = prepareApp()
    app.bootstrap!.settings = { ...app.settings, productTourStatus: 'completed', productTourStep: 5, productTourWelcomeSeen: true }
    const tour = useProductTourStore()

    tour.replay()
    expect(tour.open).toBe(true)
    expect(tour.replaying).toBe(true)
    expect(tour.currentStepIndex).toBe(0)
    await tour.goTo(2)
    expect(tour.currentStepIndex).toBe(2)
    expect(app.settings).toMatchObject({ productTourStatus: 'completed', productTourStep: 5 })
  })

  it('closes and rolls back optimistic settings when persistence fails', async () => {
    const app = prepareApp(async () => ({
      ok: false,
      error: { code: 'SETTINGS_WRITE_FAILED', message: '无法保存设置', retryable: true, userAction: '重试' }
    }))
    const tour = useProductTourStore()

    await tour.start()

    expect(tour.open).toBe(false)
    expect(app.settings.productTourStatus).toBe('pending')
    expect(app.error?.code).toBe('SETTINGS_WRITE_FAILED')
  })
})
