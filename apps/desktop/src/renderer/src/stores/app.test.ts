import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AppSettings, PetWindowState } from '@cpp-pet/contracts'
import { useAppStore } from './app'

const now = '2026-07-20T10:00:00.000Z'

function baseSettings(): AppSettings {
  return {
    theme: 'system',
    sidebarWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 190,
    cursorStyle: 'mascot',
    onboardingCompleted: true,
    onboardingStatus: 'completed',
    onboardingReminderDismissed: false,
    productTourStatus: 'completed',
    productTourStep: 5,
    productTourWelcomeSeen: true,
    agentApprovalMode: 'on-risk',
    pet: {
      visible: true,
      assetMode: 'custom',
      scale: 1,
      ignoreMouseEvents: false,
      bubbleEnabled: true,
      focusModeEnabled: false,
      launchAtLogin: false,
      customAssets: [
        { id: 'asset-1', name: '课堂猫', path: 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets/pet-1.gif', mime: 'image/gif', updatedAt: now }
      ],
      activeCustomAssetId: 'asset-1'
    }
  }
}

function seedStore(settings = baseSettings()) {
  setActivePinia(createPinia())
  const store = useAppStore()
  store.bootstrap = {
    version: 'test',
    platform: 'win32',
    recoveryMode: false,
    settings,
    recentProjects: [],
    workspaces: [],
    recentEvents: []
  }
  return store
}

describe('app store pet window state sync', () => {
  it('accepts an explicit empty custom asset library from pet state', () => {
    const store = seedStore()

    store.applyPetWindowState({
      settings: {
        visible: true,
        assetMode: 'cpppilot-logo',
        scale: 0.8,
        ignoreMouseEvents: false,
        bubbleEnabled: true,
        focusModeEnabled: false,
        launchAtLogin: false,
        customAssets: []
      },
      windowVisible: true,
      ignoreMouseEvents: false,
      growthStage: 1,
      progress: { stage: 1, totalStages: 4, percent: 25, label: 'Lv.1 · 1/4' }
    } satisfies PetWindowState)

    expect(store.settings.pet.assetMode).toBe('cpppilot-logo')
    expect(store.settings.pet.activeCustomAssetId).toBeUndefined()
    expect(store.settings.pet.customAssets).toHaveLength(0)
  })

  it('keeps the custom asset library when older pet state payloads omit that field', () => {
    const store = seedStore()

    store.applyPetWindowState({
      settings: {
        visible: true,
        assetMode: 'cpppilot-logo',
        scale: 0.8,
        ignoreMouseEvents: false,
        bubbleEnabled: true,
        focusModeEnabled: false,
        launchAtLogin: false
      },
      windowVisible: true,
      ignoreMouseEvents: false,
      growthStage: 1,
      progress: { stage: 1, totalStages: 4, percent: 25, label: 'Lv.1 · 1/4' }
    } as PetWindowState)

    expect(store.settings.pet.assetMode).toBe('cpppilot-logo')
    expect(store.settings.pet.activeCustomAssetId).toBeUndefined()
    expect(store.settings.pet.customAssets).toEqual(baseSettings().pet.customAssets)
  })

  it('activates the selected custom asset immediately when the payload includes one', () => {
    const previous = baseSettings()
    const store = seedStore({ ...previous, pet: { ...previous.pet, assetMode: 'cpppilot-logo', activeCustomAssetId: undefined } })

    store.applyPetWindowState({
      settings: baseSettings().pet,
      windowVisible: true,
      ignoreMouseEvents: false,
      growthStage: 1,
      progress: { stage: 1, totalStages: 4, percent: 25, label: 'Lv.1 · 1/4' },
      customAssetUrl: 'cpppilot-pet-asset://asset/pet-1.gif?v=2026-07-20T10%3A00%3A00.000Z'
    })

    expect(store.settings.pet.assetMode).toBe('custom')
    expect(store.settings.pet.activeCustomAssetId).toBe('asset-1')
    expect(store.settings.pet.customAssets).toEqual(baseSettings().pet.customAssets)
  })

  it('accepts an intentional switch back to the logo asset mode', () => {
    const store = seedStore()

    store.applyPetWindowState({
      settings: {
        ...baseSettings().pet,
        assetMode: 'cpppilot-logo',
        activeCustomAssetId: undefined
      },
      windowVisible: true,
      ignoreMouseEvents: false,
      growthStage: 1,
      progress: { stage: 1, totalStages: 4, percent: 25, label: 'Lv.1 · 1/4' }
    })

    expect(store.settings.pet.assetMode).toBe('cpppilot-logo')
    expect(store.settings.pet.activeCustomAssetId).toBeUndefined()
    expect(store.settings.pet.customAssets).toEqual(baseSettings().pet.customAssets)
  })

  it('applies frame and progress toggles without inventing defaults over existing values', () => {
    const previous = baseSettings()
    const store = seedStore({
      ...previous,
      pet: {
        ...previous.pet,
        bubbleEnabled: false,
        frameEnabled: true,
        progressBarEnabled: false,
        scale: 1.5
      }
    })

    store.applyPetWindowState({
      settings: {
        ...store.settings.pet,
        frameEnabled: false,
        progressBarEnabled: true
      },
      windowVisible: true,
      ignoreMouseEvents: false,
      growthStage: 1,
      progress: { stage: 1, totalStages: 4, percent: 25, label: 'Lv.1 · 1/4' }
    })

    expect(store.settings.pet.frameEnabled).toBe(false)
    expect(store.settings.pet.progressBarEnabled).toBe(true)
    expect(store.settings.pet.bubbleEnabled).toBe(false)
    expect(store.settings.pet.scale).toBe(1.5)
    expect(store.settings.pet.assetMode).toBe('custom')
    expect(store.settings.pet.activeCustomAssetId).toBe('asset-1')
  })
})