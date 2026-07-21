import { randomUUID } from 'node:crypto'
import type { AgentStartRequest, ScreenshotRef } from '@cpp-pet/contracts'

interface ScreenshotRefInput {
  previewDataUrl: string
  width: number
  height: number
}

interface ScreenshotAgentRequestInput {
  message: string
  projectId?: string
  activeFile?: string
  conversationId?: string
  assistantMessageId?: string
  screenshot: ScreenshotRef
}

export function createScreenshotRef(input: ScreenshotRefInput): ScreenshotRef {
  return {
    id: randomUUID(),
    previewDataUrl: input.previewDataUrl,
    mimeType: mimeTypeFromDataUrl(input.previewDataUrl),
    width: input.width,
    height: input.height,
    createdAt: new Date().toISOString()
  }
}

export function createScreenshotAgentRequest(input: ScreenshotAgentRequestInput): AgentStartRequest {
  return {
    requestId: randomUUID(),
    source: 'screenshot',
    mode: 'auto',
    message: input.message,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.activeFile ? { activeFile: input.activeFile } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.assistantMessageId ? { assistantMessageId: input.assistantMessageId } : {}),
    screenshot: input.screenshot
  }
}

function mimeTypeFromDataUrl(dataUrl: string): ScreenshotRef['mimeType'] {
  if (dataUrl.startsWith('data:image/jpeg')) return 'image/jpeg'
  if (dataUrl.startsWith('data:image/webp')) return 'image/webp'
  return 'image/png'
}