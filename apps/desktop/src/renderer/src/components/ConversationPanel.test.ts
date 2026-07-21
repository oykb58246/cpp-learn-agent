import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@cpp-pet/contracts'
import { useAgentStore } from '../stores/agent'
import ConversationPanel from './ConversationPanel.vue'

vi.mock('../utils/markdown', () => ({ renderMarkdown: (source: string) => source }))

const now = new Date().toISOString()

function renderPanel(input: { projectId?: string; activeFile?: string; messages?: AgentMessage[]; selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; content: string }; conversationId?: string }) {
  const projectId = input.projectId ?? crypto.randomUUID()
  const conversationId = input.conversationId ?? crypto.randomUUID()
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/workspace/:projectId', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  const app = createSSRApp({ render: () => h(ConversationPanel, { projectId, activeFile: input.activeFile ?? 'main.cpp', selection: input.selection }) })
  app.use(pinia)
  app.use(router)
  const store = useAgentStore(pinia)
  store.agentProjectId = projectId
  store.currentConversationId = conversationId
  store.conversations = [{ id: conversationId, projectId, title: '测试对话', status: 'active', createdAt: now, updatedAt: now }]
  store.messages = input.messages ?? []
  return renderToString(app as never)
}

describe('ConversationPanel', () => {
  it('renders screenshot thumbnails and the user question in conversation messages', async () => {
    const projectId = crypto.randomUUID()
    const conversationId = crypto.randomUUID()
    const screenshot = {
      id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' as const,
      width: 320, height: 180, createdAt: now
    }
    const message: AgentMessage = {
      id: crypto.randomUUID(), conversationId, role: 'user', kind: 'screenshot-question',
      content: '这里为什么报错？', status: 'completed', screenshot,
      createdAt: now, updatedAt: now, completedAt: now
    }

    const html = await renderPanel({ projectId, conversationId, activeFile: 'main.cpp', messages: [message] })

    expect(html).toContain('alt="截图提问预览"')
    expect(html).toContain(screenshot.previewDataUrl)
    expect(html).toContain('这里为什么报错？')
  })

  it('shows attached editor selection context and a quick explanation suggestion', async () => {
    const html = await renderPanel({
      activeFile: 'src/main.cpp',
      selection: { startLine: 3, startColumn: 1, endLine: 5, endColumn: 2, content: 'for (;;) {}' }
    })

    expect(html).toContain('已附带选区：src/main.cpp 行 3-5')
    expect(html).toContain('解释选区')
  })

  it('renders model failures as terminal errors without the thinking placeholder', async () => {
    const conversationId = crypto.randomUUID()
    const message: AgentMessage = {
      id: crypto.randomUUID(), conversationId, role: 'assistant', kind: 'text',
      content: 'OpenAI 请求失败，回答未完成。', status: 'failed',
      errorCode: 'MODEL_REQUEST_FAILED', errorMessage: 'OpenAI Responses request failed',
      createdAt: now, updatedAt: now, completedAt: now
    }

    const html = await renderPanel({ conversationId, messages: [message] })

    expect(html).toContain('OpenAI 请求失败，回答未完成。')
    expect(html).toContain('OpenAI Responses request failed')
    expect(html).toContain('重试')
    expect(html).not.toContain('正在组织回答')
  })
  it('renders a visible main-window route command for long assistant answers', async () => {
    const conversationId = crypto.randomUUID()
    const messageId = crypto.randomUUID()
    const message: AgentMessage = {
      id: messageId, conversationId, role: 'assistant', kind: 'text',
      content: 'x'.repeat(1201), status: 'completed', createdAt: now, updatedAt: now, completedAt: now
    }

    const html = await renderPanel({ conversationId, messages: [message] })

    expect(html).toContain(`data-message-id="${messageId}"`)
    expect(html).toContain('在主窗口查看')
  })
})
