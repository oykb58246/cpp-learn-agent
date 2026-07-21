import type { ApiResult, CppPetApi, ScreenshotCaptureRequest } from '@cpp-pet/contracts'

export interface ScreenshotCaptureContext {
  message?: string
  projectId?: string
  activeFile?: string
  conversationId?: string | null
}

export function createScreenshotCaptureRequest(input: ScreenshotCaptureContext): ScreenshotCaptureRequest {
  return {
    message: input.message?.trim() || '解释这张截图',
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.activeFile ? { activeFile: input.activeFile } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {})
  }
}

export function captureScreenshotQuestion(
  screenshotApi: CppPetApi['screenshot'],
  input: ScreenshotCaptureContext
): Promise<ApiResult<void>> {
  return screenshotApi.capture(createScreenshotCaptureRequest(input))
}