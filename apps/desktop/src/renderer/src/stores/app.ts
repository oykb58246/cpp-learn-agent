import { defineStore } from 'pinia'
import type { AppBootstrap, AppError, AppSettings, CursorStyle, MockDashboard, PetWindowState, Workspace } from '@cpp-pet/contracts'
import classicCursorUrl from '../assets/cursor-classic.png'
import mascotCursorUrl from '../assets/cursor-mascot.png'

const cursorAssets: Record<Exclude<CursorStyle, 'system'>, { url: string; hotspot: string }> = {
  classic: { url: classicCursorUrl, hotspot: '7 3' },
  mascot: { url: mascotCursorUrl, hotspot: '6 4' }
}

export const useAppStore = defineStore('app', {
  state: () => ({ bootstrap: null as AppBootstrap | null, dashboard: null as MockDashboard | null, loading: true, error: null as AppError | null }),
  getters: {
    settings: state => state.bootstrap?.settings ?? ({
      theme: 'system',
      sidebarWidth: 260,
      inspectorWidth: 320,
      bottomPanelHeight: 190,
      cursorStyle: 'mascot',
      onboardingCompleted: false,
      onboardingStatus: 'pending',
      onboardingReminderDismissed: false,
      productTourStatus: 'pending',
      productTourStep: 0,
      productTourWelcomeSeen: false,
      agentApprovalMode: 'on-risk',
      pet: {
        visible: true,
        assetMode: 'cpppilot-logo',
        scale: 1,
        ignoreMouseEvents: false,
        bubbleEnabled: true,
        frameEnabled: true,
        progressBarEnabled: true,
        edgeDockEnabled: true,
        docked: false,
        focusModeEnabled: false,
        launchAtLogin: false,
        customAssets: []
      }
    } as AppSettings),
    projects: state => state.bootstrap?.recentProjects ?? [],
    workspaces: state => state.bootstrap?.workspaces ?? []
  },
  actions: {
    async init() {
      this.loading = true
      const [boot, dash] = await Promise.all([window.cppPet.app.getBootstrap(), window.cppPet.mocks.getDashboard()])
      if (boot.ok) {
        this.bootstrap = boot.data
        applyAppearance(boot.data.settings)
      } else this.error = boot.error
      if (dash.ok) this.dashboard = dash.data
      this.loading = false
    },
    async updateSettings(patch: Partial<AppSettings>): Promise<boolean> {
      // 先本地应用，保证设置页点击/预览立即有反馈
      const previous = this.bootstrap ? { ...this.bootstrap.settings } : null
      if (this.bootstrap && patch) {
        this.bootstrap.settings = mergeAppSettings(this.bootstrap.settings, patch)
        applyAppearance(this.bootstrap.settings)
      }
      const result = await window.cppPet.settings.update(patch)
      if (result.ok && this.bootstrap) {
        this.bootstrap.settings = mergeAppSettings(this.bootstrap.settings, result.data)
        applyAppearance(this.bootstrap.settings)
        return true
      }
      if (!result.ok) {
        if (this.bootstrap && previous) {
          this.bootstrap.settings = previous
          applyAppearance(previous)
        }
        this.error = result.error
        return false
      }
      return true
    },
    async refreshProjects() { const result = await window.cppPet.project.list(); if (result.ok && this.bootstrap) this.bootstrap.recentProjects = result.data; else if (!result.ok) this.error = result.error },
    async refreshWorkspaces() { const result = await window.cppPet.workspace.list(); if (result.ok && this.bootstrap) this.bootstrap.workspaces = result.data; else if (!result.ok) this.error = result.error },
    async selectWorkspace(): Promise<Workspace | null> { const result = await window.cppPet.workspace.selectRoot(); if (!result.ok) { this.error = result.error; return null } await this.refreshWorkspaces(); return result.data },
    async setWorkspaceTrust(id: string, trusted: boolean): Promise<Workspace | null> { const result = await window.cppPet.workspace.setTrust({ workspaceId: id, trusted }); if (!result.ok) { this.error = result.error; return null } await this.refreshWorkspaces(); return result.data },
    async trustWorkspace(id: string): Promise<Workspace | null> { return this.setWorkspaceTrust(id, true) },
    applyPetWindowState(next: PetWindowState) {
      if (!this.bootstrap) return
      const previous = this.bootstrap.settings.pet
      const incoming = next.settings
      // Full pet window state from main is authoritative for fields it includes.
      // Only preserve customAssets when an older payload omits that field entirely.
      const hasCustomAssets = Object.prototype.hasOwnProperty.call(incoming, 'customAssets')
      const pet = {
        ...previous,
        ...incoming,
        assetMode: incoming.assetMode ?? previous.assetMode,
        customAssets: hasCustomAssets
          ? (incoming.customAssets ?? [])
          : (previous.customAssets ?? []),
        frameEnabled: incoming.frameEnabled ?? previous.frameEnabled ?? true,
        progressBarEnabled: incoming.progressBarEnabled ?? previous.progressBarEnabled ?? true,
        edgeDockEnabled: incoming.edgeDockEnabled ?? previous.edgeDockEnabled ?? true,
        bubbleEnabled: incoming.bubbleEnabled ?? previous.bubbleEnabled ?? true,
        docked: incoming.docked ?? previous.docked ?? false
      } as typeof previous
      if (incoming.activeCustomAssetId) pet.activeCustomAssetId = incoming.activeCustomAssetId
      else if (pet.assetMode === 'custom' && previous.activeCustomAssetId && !Object.prototype.hasOwnProperty.call(incoming, 'activeCustomAssetId')) {
        pet.activeCustomAssetId = previous.activeCustomAssetId
      } else if (!incoming.activeCustomAssetId) {
        delete (pet as { activeCustomAssetId?: string }).activeCustomAssetId
      }
      if (incoming.hiddenUntil) pet.hiddenUntil = incoming.hiddenUntil
      else delete (pet as { hiddenUntil?: string }).hiddenUntil
      this.bootstrap.settings = { ...this.bootstrap.settings, pet }
    },
    setError(error: AppError | null) { this.error = error }
  }
})

function mergeAppSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const nextPet = patch.pet ? mergeAppPetState(current, patch.pet) : current.pet
  return { ...current, ...patch, pet: nextPet }
}

function mergeAppPetState(current: AppSettings, next: PetWindowState['settings'] | AppSettings['pet']): AppSettings['pet'] {
  const customAssets = Object.prototype.hasOwnProperty.call(next, 'customAssets')
    ? next.customAssets ?? []
    : current.pet.customAssets
  const merged = { ...current.pet, ...next, customAssets }
  if (merged.assetMode !== 'custom') {
    merged.activeCustomAssetId = undefined
  } else if (!merged.activeCustomAssetId && merged.customAssets.length) {
    merged.activeCustomAssetId = merged.customAssets[0]?.id
  }
  return merged
}

function applyAppearance(settings: Pick<AppSettings, 'theme' | 'cursorStyle'>) {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.classList.toggle('dark', dark)

  const style: CursorStyle = settings.cursorStyle === 'classic' || settings.cursorStyle === 'system' || settings.cursorStyle === 'mascot'
    ? settings.cursorStyle
    : 'mascot'
  root.dataset.cursor = style

  if (style === 'system') {
    root.style.removeProperty('--app-cursor')
    root.style.removeProperty('--app-cursor-pointer')
    return
  }

  const asset = cursorAssets[style]
  const value = `url("${asset.url}") ${asset.hotspot}`
  root.style.setProperty('--app-cursor', `${value}, auto`)
  root.style.setProperty('--app-cursor-pointer', `${value}, pointer`)
}

