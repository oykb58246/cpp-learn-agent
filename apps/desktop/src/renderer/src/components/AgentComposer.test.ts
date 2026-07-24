import { createSSRApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AppSettings } from '@cpp-pet/contracts'
import AgentComposer from './AgentComposer.vue'
import { createAgentRequest } from '../utils/agent-request'
import { captureScreenshotQuestion, createScreenshotCaptureRequest } from '../utils/screenshot-request'
import { useAppStore } from '../stores/app'

function seedSettings(mode: AppSettings['agentApprovalMode'] = 'on-risk') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  store.bootstrap = {
    version: 'test',
    platform: 'win32',
    recoveryMode: false,
    settings: {
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
      agentApprovalMode: mode,
      pet: {
        visible: true,
        assetMode: 'cpppilot-logo',
        scale: 1,
        ignoreMouseEvents: false,
        bubbleEnabled: true,
        focusModeEnabled: false,
        launchAtLogin: false,
        customAssets: []
      }
    },
    recentProjects: [],
    workspaces: [],
    recentEvents: []
  }
  return pinia
}

describe('AgentComposer', () => {
  beforeEach(() => {
    seedSettings('full')
  })

  it('renders the rounded composer shell with send and stop controls', async () => {
    const pinia = seedSettings('full')
    const app = createSSRApp({
      render: () => h(AgentComposer, { busy: false, cancellable: true })
    })
    app.use(pinia)
    const html = await renderToString(app as never)

    expect(html).toContain('composer-shell')
    expect(html).toContain('<textarea')
    expect(html).toContain('composer-send stop')
    expect(html).toContain('Enter 发送 · Shift+Enter 换行')
    expect(html).toContain('完全访问')
    expect(html).toContain('lucide-shield')
  })

  it('renders a screenshot capture command and carries the current conversation context', async () => {
    const projectId = crypto.randomUUID()
    const conversationId = crypto.randomUUID()
    const pinia = seedSettings('on-risk')
    const app = createSSRApp({
      render: () => h(AgentComposer, { projectId, activeFile: 'main.cpp', conversationId })
    })
    app.use(pinia)

    const html = await renderToString(app as never)
    const request = createScreenshotCaptureRequest({ projectId, activeFile: 'main.cpp', conversationId })
    const capture = vi.fn(async () => ({ ok: true as const, data: undefined }))

    await captureScreenshotQuestion({ capture } as never, { projectId, activeFile: 'main.cpp', conversationId })

    expect(html).toContain('title="截图提问"')
    expect(html).toContain('composer-chip')
    expect(html).toContain('替我审批')
    expect(html).toContain('lucide-triangle-alert')
    expect(request).toEqual({ message: '解释这张截图', projectId, activeFile: 'main.cpp', conversationId })
    expect(capture).toHaveBeenCalledWith({ message: '解释这张截图', projectId, activeFile: 'main.cpp', conversationId })
  })

  it('keeps selected code range in the submitted agent request', () => {
    const projectId = crypto.randomUUID()
    const selection = { startLine: 4, startColumn: 3, endLine: 8, endColumn: 1, content: 'int total = 0;' }

    expect(createAgentRequest('解释这段代码', { source: 'editor', projectId, activeFile: 'main.cpp', selection })).toMatchObject({
      source: 'editor',
      mode: 'auto',
      message: '解释这段代码',
      projectId,
      activeFile: 'main.cpp',
      selection
    })
  })
})
