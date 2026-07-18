import { describe, expect, it, vi } from 'vitest'
import type { ModelProfile, OpenAiFunctionTool } from '@cpp-pet/contracts'
import { CPPPILOT_OPENAI_INSTRUCTIONS } from './openai-instructions'
import { OpenAiResponsesClient, OpenAiResponsesError } from './responses-client'

const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5',
  enabled: true, timeoutMs: 5_000, apiKeyConfigured: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}
const tools: OpenAiFunctionTool[] = [{
  type: 'function', name: 'workspace_read_file', description: 'Read a file', strict: true,
  parameters: {
    type: 'object', properties: { projectId: { type: 'string' }, relativePath: { type: 'string' } },
    required: ['projectId', 'relativePath'], additionalProperties: false
  }
}]

describe('OpenAI Responses client', () => {
  it('sends native Responses tools, instructions, context, and strict final format', async () => {
    let url = ''
    let authorization = ''
    let body: Record<string, any> = {}
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: 'resp_1', status: 'completed',
        output: [{
          type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'workspace_read_file',
          arguments: '{"projectId":"p","relativePath":"main.cpp"}', status: 'completed'
        }]
      })
    }) as typeof fetch
    const client = new OpenAiResponsesClient({ profile, apiKey: 'secret-key', tools, fetcher })
    const input = [{ role: 'user', content: [{ type: 'input_text', text: '{"protocol":"cpppilot.context.v1"}' }] }]

    const response = await client.respond(input, new AbortController().signal)

    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(authorization).toBe('Bearer secret-key')
    expect(body).toMatchObject({
      model: 'gpt-5', instructions: CPPPILOT_OPENAI_INSTRUCTIONS, input, tools,
      tool_choice: 'auto', parallel_tool_calls: false, store: false,
      text: { format: { type: 'json_schema', name: 'cpppilot_final_response', strict: true } }
    })
    expect(body.text.format.schema.$schema).toBeUndefined()
    expect(response.output[0]).toMatchObject({ type: 'function_call', call_id: 'call_1' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('preserves output items and function results in a continuation request', async () => {
    const bodies: Record<string, any>[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ id: `resp_${bodies.length}`, status: 'completed', output: [{
        type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify({
          protocol: 'cpppilot.final.v1', taskId: crypto.randomUUID(), status: 'failed',
          intent: { primary: 'answer', secondary: [] }, messageMarkdown: 'done',
          evidenceCallIds: [], suggestedNextActions: []
        }), annotations: [] }]
      }] })
    }) as typeof fetch
    const client = new OpenAiResponsesClient({ profile, apiKey: 'key', tools, fetcher })
    const input = [
      { role: 'user', content: [{ type: 'input_text', text: 'context' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'workspace_read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' }
    ]

    await client.respond(input, new AbortController().signal)

    expect(bodies[0]?.input).toEqual(input)
    expect(JSON.stringify(bodies[0])).not.toContain('key')
  })

  it('maps HTTP, incomplete, and malformed responses to explicit errors', async () => {
    const http = new OpenAiResponsesClient({ profile, apiKey: 'secret', tools, fetcher: vi.fn(async () => new Response('bad', { status: 503 })) as typeof fetch })
    await expect(http.respond([], new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_REQUEST_FAILED' })

    const incomplete = new OpenAiResponsesClient({ profile, apiKey: 'secret', tools, fetcher: vi.fn(async () => Response.json({
      id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: []
    })) as typeof fetch })
    await expect(incomplete.respond([], new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_INCOMPLETE' })

    const malformed = new OpenAiResponsesClient({ profile, apiKey: 'secret', tools, fetcher: vi.fn(async () => Response.json({
      id: 'resp_1', status: 'completed', output: [{ type: 'unknown' }]
    })) as typeof fetch })
    await expect(malformed.respond([], new AbortController().signal)).rejects.toBeInstanceOf(OpenAiResponsesError)
    await expect(malformed.respond([], new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_PROTOCOL_INVALID' })
  })

  it('instructs the model to own language understanding and use evidence', () => {
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('original user prompt')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('incomplete quotes')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('tool evidence')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).not.toContain('regular expression')
  })
})
