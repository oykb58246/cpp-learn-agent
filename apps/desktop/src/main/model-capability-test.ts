import type { ModelProfile } from '@cpp-pet/contracts'
import {
  deepSeekChatCompletionsUrl,
  isDeepSeekApiBaseUrl,
  openAiChatCompletionsUrl,
  resolveModelProtocol
} from '@cpp-pet/agent-runtime'

const redPixelDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const prompt = 'Inspect the attached image. Reply with exactly VISION_OK if it is solid red; otherwise reply with exactly VISION_MISMATCH.'

export interface VisionTestResult {
  supported: boolean
  latencyMs: number
  detail: string
  protocol: Exclude<ModelProfile['protocol'], 'auto'>
}

export async function testModelVisionCapability(input: {
  profile: ModelProfile
  apiKey: string
  fetcher?: typeof fetch
}): Promise<VisionTestResult> {
  const protocol = resolveModelProtocol(input.profile)
  const chatCompletions = protocol === 'openai-chat-completions'
  const endpoint = chatCompletions
    ? input.profile.provider === 'deepseek' || isDeepSeekApiBaseUrl(input.profile.baseUrl)
      ? deepSeekChatCompletionsUrl(input.profile.baseUrl)
      : openAiChatCompletionsUrl(input.profile.baseUrl)
    : `${input.profile.baseUrl.replace(/\/$/, '')}/responses`
  const body = chatCompletions
    ? {
        model: input.profile.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: redPixelDataUrl, detail: 'low' } }
          ]
        }],
        max_tokens: 32,
        stream: false
      }
    : {
        model: input.profile.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: redPixelDataUrl, detail: 'low' }
          ]
        }],
        max_output_tokens: 32,
        store: false
      }

  const started = Date.now()
  const response = await (input.fetcher ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.profile.timeoutMs)
  })
  const latencyMs = Date.now() - started

  if (!response.ok) {
    if ([400, 404, 415, 422].includes(response.status)) {
      return {
        supported: false,
        latencyMs,
        detail: `服务拒绝了图片输入（HTTP ${response.status}）。`,
        protocol
      }
    }
    throw new Error(`Vision capability test failed with HTTP ${response.status}`)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    return { supported: false, latencyMs, detail: '服务接受了请求，但返回内容无法解析。', protocol }
  }
  const text = extractResponseText(raw).trim().toUpperCase()
  if (text === 'VISION_OK') {
    return { supported: true, latencyMs, detail: '模型正确识别了测试图片。', protocol }
  }
  return {
    supported: false,
    latencyMs,
    detail: '服务接受了图片请求，但模型没有正确识别测试图片。',
    protocol
  }
}

function extractResponseText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  const choices = Array.isArray(record.choices) ? record.choices : []
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message
    : undefined
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string') return content
  }
  const output = Array.isArray(record.output) ? record.output : []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const typed = part as Record<string, unknown>
      if (typed.type === 'output_text' && typeof typed.text === 'string') return typed.text
    }
  }
  return ''
}
