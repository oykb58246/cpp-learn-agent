import { describe, expect, it, vi } from 'vitest'
import type { ModelProfile } from '@cpp-pet/contracts'
import { testModelVisionCapability } from './model-capability-test'

const profile: ModelProfile = {
  id: crypto.randomUUID(),
  name: 'Vision model',
  provider: 'openai',
  protocol: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  model: 'vision-model',
  capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
  enabled: true,
  timeoutMs: 30_000,
  apiKeyConfigured: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

describe('model vision capability test', () => {
  it('sends a native Responses image request and recognizes a successful result', async () => {
    let url = ''
    let body: Record<string, any> = {}
    const result = await testModelVisionCapability({
      profile,
      apiKey: 'secret',
      fetcher: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        url = String(input)
        body = JSON.parse(String(init?.body))
        return Response.json({ output_text: 'VISION_OK' })
      }) as typeof fetch
    })

    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: expect.stringMatching(/^data:image\/png;base64,/) })
    ]))
    expect(result.supported).toBe(true)
  })

  it('uses Chat Completions for compatible profiles and reports rejected images', async () => {
    let url = ''
    const result = await testModelVisionCapability({
      profile: { ...profile, provider: 'custom', protocol: 'openai-chat-completions', baseUrl: 'https://gateway.example/v1' },
      apiKey: 'secret',
      fetcher: vi.fn(async input => {
        url = String(input)
        return new Response('', { status: 415 })
      }) as typeof fetch
    })

    expect(url).toBe('https://gateway.example/v1/chat/completions')
    expect(result).toMatchObject({ supported: false, protocol: 'openai-chat-completions' })
  })

  it('does not accept a response that merely mentions the success token', async () => {
    const result = await testModelVisionCapability({
      profile,
      apiKey: 'secret',
      fetcher: vi.fn(async () => Response.json({
        output_text: 'The expected token would be VISION_OK, but I cannot inspect images.'
      })) as typeof fetch
    })

    expect(result.supported).toBe(false)
  })
})
