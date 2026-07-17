import type { ModelProfile } from '@cpp-pet/contracts'

export interface StreamingCompletionInput {
  profile: ModelProfile
  apiKey: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export class StreamingModelGateway {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async stream(
    input: StreamingCompletionInput,
    signal: AbortSignal,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const timeout = AbortSignal.timeout(input.profile.timeoutMs)
    const response = await this.fetcher(this.endpoint(input.profile.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: input.profile.model, temperature: 0.2, stream: true, messages: input.messages }),
      signal: AbortSignal.any([signal, timeout])
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000).trim()
      throw new Error(`模型请求失败，HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    if (!response.body) throw new Error('模型响应没有可读取的数据流。')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      buffer += decoder.decode(chunk.value, { stream: !done })
      let boundary = frameBoundary(buffer)
      while (boundary) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        if (await this.consumeFrame(frame, onDelta)) return
        boundary = frameBoundary(buffer)
      }
    }
    if (buffer.trim()) await this.consumeFrame(buffer, onDelta)
  }

  private async consumeFrame(frame: string, onDelta: (delta: string) => void | Promise<void>): Promise<boolean> {
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data) return false
    if (data === '[DONE]') return true
    try {
      const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> }
      const content = payload.choices?.[0]?.delta?.content
      if (typeof content === 'string' && content) await onDelta(content)
      return false
    } catch {
      throw new Error('收到无效的流式模型响应。')
    }
  }

  private endpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/$/, '')
    return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
  }
}

function frameBoundary(buffer: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer)
  return match?.index === undefined ? undefined : { index: match.index, length: match[0].length }
}
