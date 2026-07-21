import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'
import SettingsView from './SettingsView.vue'

const settings: AppSettings = {
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
  pet: {
    visible: true,
    assetMode: 'custom',
    scale: 1,
    ignoreMouseEvents: false,
    bubbleEnabled: true,
    focusModeEnabled: true,
    launchAtLogin: true,
    customAssets: [
      { id: 'asset-1', name: '课堂猫', path: 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets/pet-123.gif', mime: 'image/gif', updatedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'asset-2', name: '调试猫', path: 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets/pet-456.png', mime: 'image/png', updatedAt: '2026-07-20T10:10:00.000Z' }
    ],
    activeCustomAssetId: 'asset-1',
    hiddenUntil: '2026-07-20T11:00:00.000Z'
  }
}

describe('SettingsView pet settings', () => {
  it('renders custom asset library, timed hide, focus mode and launch-at-login controls', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
    await router.push('/settings')
    const appStore = useAppStore(pinia)
    appStore.bootstrap = {
      version: 'test',
      platform: 'win32',
      recoveryMode: false,
      settings,
      recentProjects: [],
      workspaces: [],
      recentEvents: []
    }
    const app = createSSRApp({ render: () => h(SettingsView) })
    app.use(pinia)
    app.use(router)

    const html = await renderToString(app as never)

    expect(html).toContain('自定义素材库')
    expect(html).toContain('课堂猫')
    expect(html).toContain('调试猫')
    expect(html).toContain('2 个本地素材')
    expect(html).toContain('创建桌宠')
    expect(html).toContain('切回 Logo')
    expect(html).toContain('删除自定义素材')
    expect(html).not.toContain('成长形象')
    expect(html).not.toContain('光标形象')
    expect(html).toContain('隐藏一小时')
    expect(html).toContain('取消隐藏')
    expect(html).toContain('专注模式')
    expect(html).toContain('开机启动')
  })
})

