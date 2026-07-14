import { defineStore } from 'pinia'
import type { AppBootstrap, AppError, AppSettings, MockDashboard, Workspace } from '@cpp-pet/contracts'

export const useAppStore = defineStore('app', {
  state: () => ({ bootstrap: null as AppBootstrap | null, dashboard: null as MockDashboard | null, loading: true, error: null as AppError | null }),
  getters: {
    settings: state => state.bootstrap?.settings ?? ({
      theme: 'system',
      sidebarWidth: 260,
      inspectorWidth: 320,
      bottomPanelHeight: 190,
      onboardingCompleted: false,
      onboardingStatus: 'pending',
      onboardingReminderDismissed: false
    } as AppSettings),
    projects: state => state.bootstrap?.recentProjects ?? [],
    workspaces: state => state.bootstrap?.workspaces ?? []
  },
  actions: {
    async init() {
      this.loading = true
      const [boot, dash] = await Promise.all([window.cppPet.app.getBootstrap(), window.cppPet.mocks.getDashboard()])
      if (boot.ok) { this.bootstrap = boot.data; applyTheme(boot.data.settings.theme) } else this.error = boot.error
      if (dash.ok) this.dashboard = dash.data
      this.loading = false
    },
    async updateSettings(patch: Partial<AppSettings>) {
      const result = await window.cppPet.settings.update(patch)
      if (result.ok && this.bootstrap) { this.bootstrap.settings = result.data; applyTheme(result.data.theme) } else if (!result.ok) this.error = result.error
    },
    async refreshProjects() { const result = await window.cppPet.project.list(); if (result.ok && this.bootstrap) this.bootstrap.recentProjects = result.data; else if (!result.ok) this.error = result.error },
    async refreshWorkspaces() { const result = await window.cppPet.workspace.list(); if (result.ok && this.bootstrap) this.bootstrap.workspaces = result.data; else if (!result.ok) this.error = result.error },
    async selectWorkspace(): Promise<Workspace | null> { const result = await window.cppPet.workspace.selectRoot(); if (!result.ok) { this.error = result.error; return null } await this.refreshWorkspaces(); return result.data },
    async trustWorkspace(id: string): Promise<Workspace | null> { const result = await window.cppPet.workspace.setTrust({ workspaceId: id, trusted: true }); if (!result.ok) { this.error = result.error; return null } await this.refreshWorkspaces(); return result.data },
    setError(error: AppError | null) { this.error = error }
  }
})

function applyTheme(theme: AppSettings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
