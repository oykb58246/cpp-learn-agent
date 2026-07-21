import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import AgentComposer from './AgentComposer.vue'
import { createAgentRequest } from '../utils/agent-request'
import { captureScreenshotQuestion, createScreenshotCaptureRequest } from '../utils/screenshot-request'

describe('AgentComposer', () => {
  it('keeps the prompt input and submit command available while a run is cancellable', async () => {
    const app = createSSRApp({
      render: () => h(AgentComposer, { busy: false, cancellable: true })
    })

    const html = await renderToString(app as never)

    expect(html).toContain('<textarea')
    expect(html).toContain('class="icon-command stop"')
    expect(html).toContain('class="primary-command"')
  })

  it('renders a screenshot capture command and carries the current conversation context', async () => {
    const projectId = crypto.randomUUID()
    const conversationId = crypto.randomUUID()
    const app = createSSRApp({
      render: () => h(AgentComposer, { projectId, activeFile: 'main.cpp', conversationId })
    })

    const html = await renderToString(app as never)
    const request = createScreenshotCaptureRequest({ projectId, activeFile: 'main.cpp', conversationId })
    const capture = vi.fn(async () => ({ ok: true as const, data: undefined }))

    await captureScreenshotQuestion({ capture } as never, { projectId, activeFile: 'main.cpp', conversationId })

    expect(html).toContain('title="截图提问"')
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
