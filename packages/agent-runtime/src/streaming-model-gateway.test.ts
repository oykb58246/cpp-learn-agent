import { describe, expect, it } from 'vitest'
import type { ModelProfile } from '@cpp-pet/contracts'
import { StreamingModelGateway } from './streaming-model-gateway'

const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'Test', baseUrl: 'https://model.example/v1', model: 'teacher', enabled: true,
  timeoutMs: 5_000, apiKeyConfigured: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}

function chunkedResponse(source: string, chunkSize = 1): Response {
  const bytes = new TextEncoder().encode(source)
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize))
      controller.close()
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('StreamingModelGateway', () => {
  it('parses Chinese text split across arbitrary byte and SSE boundaries', async () => {
    const source = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n'
    ].join('')
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const gateway = new StreamingModelGateway(async (url, init) => {
      requests.push({ url: String(url), init })
      return chunkedResponse(source)
    })
    const deltas: string[] = []
    await gateway.stream({ profile, apiKey: 'secret', messages: [{ role: 'user', content: '问候' }] }, new AbortController().signal, delta => { deltas.push(delta) })
    expect(deltas).toEqual(['你', '好'])
    expect(requests[0]?.url).toBe('https://model.example/v1/chat/completions')
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({ model: 'teacher', stream: true })
    expect((requests[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('surfaces bounded HTTP response details', async () => {
    const gateway = new StreamingModelGateway(async () => new Response('gateway unavailable', { status: 503 }))
    await expect(gateway.stream({ profile, apiKey: 'secret', messages: [] }, new AbortController().signal, () => undefined))
      .rejects.toThrow('HTTP 503: gateway unavailable')
  })

  it('rejects malformed non-empty data frames', async () => {
    const gateway = new StreamingModelGateway(async () => chunkedResponse('data: {bad json}\n\n'))
    await expect(gateway.stream({ profile, apiKey: 'secret', messages: [] }, new AbortController().signal, () => undefined))
      .rejects.toThrow('无效的流式模型响应')
  })

  it('honors an already aborted caller signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    const gateway = new StreamingModelGateway(async () => { called = true; return chunkedResponse('data: [DONE]\n\n') })
    await expect(gateway.stream({ profile, apiKey: 'secret', messages: [] }, controller.signal, () => undefined)).rejects.toThrow()
    expect(called).toBe(false)
  })
})
