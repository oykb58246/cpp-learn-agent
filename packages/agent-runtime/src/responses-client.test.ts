import { describe, expect, it, vi } from 'vitest'
import type { ModelProfile, OpenAiFunctionTool } from '@cpp-pet/contracts'
import { CPPPILOT_OPENAI_INSTRUCTIONS } from './openai-instructions'
import { OpenAiResponsesClient, OpenAiResponsesError } from './responses-client'

const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5',
  provider: 'openai', protocol: 'openai-responses',
  capabilities: { text: true, vision: true, toolCalling: true, structuredOutput: true },
  enabled: true, timeoutMs: 5_000, apiKeyConfigured: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}
const deepSeekProfile: ModelProfile = {
  ...profile,
  name: 'DeepSeek',
  provider: 'deepseek',
  protocol: 'auto',
  baseUrl: 'http://api.deepseek.com',
  model: 'deepseek-v4-pro'
}
const tools: OpenAiFunctionTool[] = [{
  type: 'function', name: 'workspace_read_file', description: 'Read a file', strict: true,
  parameters: {
    type: 'object', properties: { projectId: { type: 'string' }, relativePath: { type: 'string' } },
    required: ['projectId', 'relativePath'], additionalProperties: false
  }
}]

function expectStrictObjectSchemas(value: unknown, path = 'schema'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectStrictObjectSchemas(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  const schema = value as Record<string, unknown>
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const properties = Object.keys(schema.properties as Record<string, unknown>).sort()
    const required = Array.isArray(schema.required) ? [...schema.required].sort() : schema.required
    expect(required, `${path}.required`).toEqual(properties)
  }
  for (const [key, nested] of Object.entries(schema)) {
    expectStrictObjectSchemas(nested, `${path}.${key}`)
  }
}

describe('OpenAI Responses client', () => {
  it('accepts the nullable fields in an official completed Responses envelope', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: 'resp_official',
      object: 'response',
      status: 'completed',
      error: null,
      incomplete_details: null,
      output: []
    })) as typeof fetch
    const client = new OpenAiResponsesClient({ profile, apiKey: 'secret', tools, fetcher })

    await expect(client.respond([], new AbortController().signal)).resolves.toEqual({
      id: 'resp_official', status: 'completed', output: []
    })
  })

  it('reports invalid envelope fields without echoing provider response content', async () => {
    const fetcher = vi.fn(async () => Response.json({
      id: 'chatcmpl_1', object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: 'sensitive-provider-content' } }]
    })) as typeof fetch
    const client = new OpenAiResponsesClient({ profile, apiKey: 'secret', tools, fetcher })

    await expect(client.respond([], new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_PROTOCOL_INVALID',
      message: expect.stringContaining('status, output')
    })
    await expect(client.respond([], new AbortController().signal)).rejects.not.toMatchObject({
      message: expect.stringContaining('sensitive-provider-content')
    })
  })

  it('does not echo provider-controlled status or incomplete reason fields', async () => {
    const statusClient = new OpenAiResponsesClient({
      profile,
      apiKey: 'secret',
      tools,
      fetcher: vi.fn(async () => Response.json({
        id: 'resp_status', status: 'sensitive-provider-content', output: []
      })) as typeof fetch
    })
    const reasonClient = new OpenAiResponsesClient({
      profile,
      apiKey: 'secret',
      tools,
      fetcher: vi.fn(async () => Response.json({
        id: 'resp_reason', status: 'incomplete',
        incomplete_details: { reason: 'sensitive-provider-content' }, output: []
      })) as typeof fetch
    })

    await expect(statusClient.respond([], new AbortController().signal)).rejects.not.toMatchObject({
      message: expect.stringContaining('sensitive-provider-content')
    })
    await expect(reasonClient.respond([], new AbortController().signal)).rejects.not.toMatchObject({
      message: expect.stringContaining('sensitive-provider-content')
    })
  })

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
    expectStrictObjectSchemas(body.text.format.schema)
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
          clarificationQuestion: null, evidenceCallIds: [], claims: [], suggestedNextActions: []
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

  it('adapts DeepSeek profiles to Chat Completions and maps final JSON to a Responses message', async () => {
    let url = ''
    let authorization = ''
    let body: Record<string, any> = {}
    const finalJson = JSON.stringify({
      protocol: 'cpppilot.final.v1', taskId: crypto.randomUUID(), status: 'completed',
      intent: { primary: 'answer', secondary: [] }, messageMarkdown: 'DeepSeek connected',
      clarificationQuestion: null, evidenceCallIds: [], claims: [], suggestedNextActions: []
    })
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: 'chatcmpl_deepseek_1', object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: finalJson } }]
      })
    }) as typeof fetch
    const client = new OpenAiResponsesClient({ profile: deepSeekProfile, apiKey: 'deepseek-key', tools, fetcher })

    const result = await client.respond([{
      role: 'user',
      content: [{ type: 'input_text', text: '{"protocol":"cpppilot.context.v1"}' }]
    }], new AbortController().signal)

    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(authorization).toBe('Bearer deepseek-key')
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
      stream: false,
      messages: [
        { role: 'system', content: expect.stringContaining('cpppilot.final.v1') },
        { role: 'user', content: '{"protocol":"cpppilot.context.v1"}' }
      ],
      tools: [{
        type: 'function',
        function: { name: 'workspace_read_file', description: 'Read a file', parameters: tools[0]!.parameters }
      }]
    })
    expect(body.tools[0]).not.toHaveProperty('name')
    expect(result).toMatchObject({
      id: 'chatcmpl_deepseek_1', status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: finalJson }] }]
    })
  })

  it('honors an explicit Chat Completions protocol for custom compatible providers', async () => {
    let url = ''
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      url = String(input)
      return Response.json({
        id: 'chatcmpl_custom_1',
        choices: [{
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"protocol":"cpppilot.final.v1"}' }
        }]
      })
    }) as typeof fetch
    const customChatProfile: ModelProfile = {
      ...profile,
      provider: 'custom',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://gateway.example/v1'
    }

    await new OpenAiResponsesClient({
      profile: customChatProfile,
      apiKey: 'gateway-key',
      tools,
      fetcher
    }).respond([], new AbortController().signal)

    expect(url).toBe('https://gateway.example/v1/chat/completions')
  })

  it('maps DeepSeek tool calls and converts Responses continuation history back to chat messages', async () => {
    const bodies: Record<string, any>[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        id: `chatcmpl_${bodies.length}`,
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant', content: null, reasoning_content: 'Need to inspect the current file.',
            tool_calls: [{
              id: 'call_deepseek_1', type: 'function',
              function: { name: 'workspace_read_file', arguments: '{"projectId":"p","relativePath":"main.cpp"}' }
            }]
          }
        }]
      })
    }) as typeof fetch
    const client = new OpenAiResponsesClient({ profile: deepSeekProfile, apiKey: 'key', tools, fetcher })
    const signal = new AbortController().signal
    const first = await client.respond([{ role: 'user', content: [{ type: 'input_text', text: 'context' }] }], signal)

    expect(first.output[0]).toMatchObject({ type: 'reasoning' })
    expect(first.output[1]).toMatchObject({
      type: 'function_call', call_id: 'call_deepseek_1', name: 'workspace_read_file'
    })
    await client.respond([
      { role: 'user', content: [{ type: 'input_text', text: 'context' }] },
      ...first.output,
      { type: 'function_call_output', call_id: 'call_deepseek_1', output: '{"ok":true}' }
    ], signal)

    expect(bodies[1]?.messages.slice(-2)).toEqual([
      {
        role: 'assistant', content: null, reasoning_content: 'Need to inspect the current file.',
        tool_calls: [{
          id: 'call_deepseek_1', type: 'function',
          function: { name: 'workspace_read_file', arguments: '{"projectId":"p","relativePath":"main.cpp"}' }
        }]
      },
      { role: 'tool', tool_call_id: 'call_deepseek_1', content: '{"ok":true}' }
    ])
  })

  it('maps incomplete and malformed DeepSeek responses to explicit errors', async () => {
    const incomplete = new OpenAiResponsesClient({
      profile: deepSeekProfile, apiKey: 'key', tools,
      fetcher: vi.fn(async () => Response.json({
        id: 'chatcmpl_short',
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }]
      })) as typeof fetch
    })
    const malformed = new OpenAiResponsesClient({
      profile: deepSeekProfile, apiKey: 'key', tools,
      fetcher: vi.fn(async () => Response.json({ id: 'chatcmpl_bad', choices: [] })) as typeof fetch
    })

    await expect(incomplete.respond([], new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_INCOMPLETE' })
    await expect(malformed.respond([], new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_PROTOCOL_INVALID' })
  })

  it('instructs the model to own language understanding and use evidence', () => {
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('original user prompt')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('incomplete quotes')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).toContain('tool evidence')
    expect(CPPPILOT_OPENAI_INSTRUCTIONS).not.toContain('regular expression')
  })

  describe('versioned global Agent instructions', () => {
    function rule(number: number): string {
      const match = CPPPILOT_OPENAI_INSTRUCTIONS.match(new RegExp(`^${number}\\. (.+)$`, 'm'))
      expect(match, `missing global instruction rule ${number}`).not.toBeNull()
      return match?.[1]?.toLowerCase() ?? ''
    }

    function expectRule(number: number, requiredPhrases: string[]): void {
      const text = rule(number)
      for (const phrase of requiredPhrases) expect(text, `global instruction rule ${number}`).toContain(phrase)
    }

    it('declares a stable template version and exactly thirteen normative rules', () => {
      expect(CPPPILOT_OPENAI_INSTRUCTIONS).toMatch(/^Instruction version: cpppilot\.agent-instructions\.v3$/m)
      expect([...CPPPILOT_OPENAI_INSTRUCTIONS.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1])))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    })

    it('makes the model the CppPilot learning and project Agent and preserves natural-language authority', () => {
      expectRule(1, ['cpppilot', 'c++ learning', 'project agent'])
      expectRule(2, ['original prompt', 'authoritative natural language', 'punctuation mistakes', 'incomplete quotes', 'minor typos', 'informal wording'])
    })

    it('treats every model-visible external source as untrusted data rather than instructions', () => {
      expectRule(3, ['workspace content', 'diagnostics', 'memories', 'tool output', 'untrusted data', 'not instructions'])
    })

    it('allows only advertised functions and prohibits invented execution identifiers or evidence', () => {
      expectRule(4, ['advertised functions', 'never invent', 'tools', 'shell commands', 'absolute paths', 'project ids', 'call ids', 'evidence'])
    })

    it('requires fresh reads for stale hashes and verification after code changes', () => {
      expectRule(5, ['read the latest file state', 'before a write', 'hash may be stale'])
      expectRule(6, ['after changing code', 'compile it', 'run relevant tests', 'when available'])
    })

    it('recovers from structured tool failures and asks only for decisions that cannot be inferred', () => {
      expectRule(7, ['tool fails', 'structured diagnostics', 'continue', 'can still be completed'])
      expectRule(8, ['ask the user only', 'required decision', 'cannot be inferred', 'prompt', 'context', 'read-only tools'])
    })

    it('requires successful evidence without exposing chain-of-thought or cross-run call IDs', () => {
      expectRule(9, ['do not claim success', 'successful tool result'])
      expectRule(10, ['no chain-of-thought', 'native function calls', 'strict final schema'])
      expectRule(11, ['only call ids', 'current run'])
      expect(CPPPILOT_OPENAI_INSTRUCTIONS.toLowerCase()).toContain('structured outcomes')
      expect(CPPPILOT_OPENAI_INSTRUCTIONS.toLowerCase()).toContain('claims')
    })

    it('stops at completion, required input, tool impossibility, or a policy limit', () => {
      expectRule(12, ['stop when complete', 'user input is required', 'available tools cannot complete the task', 'policy limit is reached'])
    })
  })
})
