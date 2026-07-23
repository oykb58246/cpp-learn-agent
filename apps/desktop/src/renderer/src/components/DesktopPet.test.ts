import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import DesktopPet from './DesktopPet.vue'

const state = {
  settings: { visible: true, assetMode: 'salary-cat' as const, scale: 1, ignoreMouseEvents: false, bubbleEnabled: true, focusModeEnabled: false, launchAtLogin: false, customAssets: [] },
  windowVisible: true,
  ignoreMouseEvents: false,
  growthStage: 1 as const,
  progress: { stage: 1 as const, totalStages: 4 as const, percent: 25, label: '第 1 关 / 共 4 关 · 入门' }
}

describe('DesktopPet', () => {
  it('renders the selected pet asset, pass progress and latest event bubble', async () => {
    const app = createSSRApp({
      render: () => h(DesktopPet, {
        state,
        event: { eventId: crypto.randomUUID(), state: 'level-up', message: '等级提升到 Lv.2' }
      })
    })

    const html = await renderToString(app as never)

    expect(html).toContain('desktop-pet state-level-up pass-stage-1')
    expect(html).toContain('pet-status-frame frame-level-up')
    expect(html).toContain('alt="Salary Cat 桌宠"')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('第 1 关 / 共 4 关 · 入门')
    expect(html).toContain('25%')
    expect(html).toContain('等级提升到 Lv.2')
  })

  it('uses the logo as the default pet image and no longer renders growth stage image or cursor assets', async () => {
    const app = createSSRApp({
      render: () => h(DesktopPet, {
        state: {
          ...state,
          settings: { ...state.settings, assetMode: 'cpppilot-logo' as const },
          growthStage: 4 as const,
          progress: { stage: 4 as const, totalStages: 4 as const, percent: 100, label: '第 4 关 / 共 4 关 · 通关' }
        },
        event: { eventId: crypto.randomUUID(), state: 'thinking' }
      })
    })

    const html = await renderToString(app as never)

    expect(html).toContain('pass-stage-4')
    expect(html).toContain('alt="CppPilot Logo 桌宠"')
    expect(html).toContain('desktop-pet-image logo')
    expect(html).toContain('第 4 关 / 共 4 关 · 通关')
    expect(html).not.toContain('CppPilot 成长阶段')
    expect(html).not.toContain('CppPilot 光标桌宠')
    expect(html).not.toContain('desktop-pet-image stage')
    expect(html).not.toContain('growth-stage-')
  })

  it('renders a distinct frame class for every pet event state', async () => {
    const states = ['idle', 'listen', 'thinking', 'tool-running', 'approval', 'success', 'warning', 'level-up'] as const

    for (const eventState of states) {
      const app = createSSRApp({
        render: () => h(DesktopPet, {
          state,
          ...(eventState === 'idle' ? {} : { event: { eventId: crypto.randomUUID(), state: eventState } })
        })
      })

      const html = await renderToString(app as never)

      expect(html).toContain(`state-${eventState}`)
      expect(html).toContain(`frame-${eventState}`)
    }
  })

  it('renders the active custom asset url and the quick chat input bubble', async () => {
    const app = createSSRApp({
      render: () => h(DesktopPet, {
        state: {
          ...state,
          settings: {
            ...state.settings,
            assetMode: 'custom' as const,
            customAssets: [{ id: 'asset-1', name: '我的猫', path: 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets/my-cat.gif', mime: 'image/gif' as const, updatedAt: '2026-07-20T10:00:00.000Z' }],
            activeCustomAssetId: 'asset-1'
          },
          customAssetUrl: 'cpppilot-pet-asset://asset/my-cat.gif?v=2026-07-20T10%3A00%3A00.000Z'
        },
        chatOpen: true,
        chatNotice: '已发送，回答可在主窗口查看'
      })
    })

    const html = await renderToString(app as never)

    expect(html).toContain('src="cpppilot-pet-asset://asset/my-cat.gif?v=2026-07-20T10%3A00%3A00.000Z"')
    expect(html).toContain('alt="我的猫"')
    expect(html).toContain('class="pet-chat-card"')
    expect(html).toContain('已发送，回答可在主窗口查看')
  })
})

