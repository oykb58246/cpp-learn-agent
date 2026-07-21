import { describe, expect, it } from 'vitest'
import { createScreenshotAgentRequest, createScreenshotRef } from './screenshot-flow'

describe('screenshot multimodal flow', () => {
  it('creates an Agent screenshot request without OCR text extraction', () => {
    const previewDataUrl = 'data:image/png;base64,AAAA'
    const screenshot = createScreenshotRef({ previewDataUrl, width: 320, height: 180 })
    const request = createScreenshotAgentRequest({ message: '解释这张截图', projectId: crypto.randomUUID(), screenshot })

    expect(screenshot).toMatchObject({ previewDataUrl, mimeType: 'image/png', width: 320, height: 180 })
    expect(request).toMatchObject({ source: 'screenshot', mode: 'auto', message: '解释这张截图', screenshot })
    expect(JSON.stringify(request)).not.toContain('ocr')
  })

  it('links screenshot Agent requests to the assistant message created for a conversation', () => {
    const screenshot = createScreenshotRef({ previewDataUrl: 'data:image/png;base64,AAAA', width: 320, height: 180 })
    const conversationId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()

    const request = createScreenshotAgentRequest({
      message: '解释这张截图',
      projectId: crypto.randomUUID(),
      activeFile: 'main.cpp',
      conversationId,
      assistantMessageId,
      screenshot
    })

    expect(request).toMatchObject({
      source: 'screenshot',
      mode: 'auto',
      activeFile: 'main.cpp',
      conversationId,
      assistantMessageId,
      screenshot
    })
  })
})