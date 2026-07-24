import {
  cppPilotFinalResponseSchema,
  openAiResponseOutputItemSchema,
  type ModelProfile,
  type OpenAiFunctionTool,
  type OpenAiResponseOutputItem
} from '@cpp-pet/contracts'
import { z } from 'zod'
import { CPPPILOT_OPENAI_INSTRUCTIONS } from './openai-instructions'

export type OpenAiResponseInputItem = Record<string, unknown>

export interface OpenAiResponsesResult {
  id: string
  status: 'completed'
  output: OpenAiResponseOutputItem[]
}

export type OpenAiResponsesErrorCode =
  | 'MODEL_REQUEST_FAILED'
  | 'MODEL_INCOMPLETE'
  | 'MODEL_PROTOCOL_INVALID'

export class OpenAiResponsesError extends Error {
  constructor(
    public readonly code: OpenAiResponsesErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'OpenAiResponsesError'
  }
}

export interface OpenAiResponsesClientOptions {
  profile: ModelProfile
  apiKey: string
  tools: OpenAiFunctionTool[]
  fetcher?: typeof fetch
}

const responseEnvelopeSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  output: z.array(z.unknown()),
  incomplete_details: z.object({ reason: z.string().optional() }).passthrough().nullable().optional()
}).passthrough()

const chatCompletionEnvelopeSchema = z.object({
  id: z.string().min(1),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      role: z.literal('assistant'),
      content: z.string().nullable().optional(),
      refusal: z.string().nullable().optional(),
      reasoning_content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1).max(200),
        type: z.literal('function'),
        function: z.object({
          name: z.string().min(1).max(120),
          arguments: z.string().max(2_097_152)
        }).passthrough()
      }).passthrough()).optional()
    }).passthrough()
  }).passthrough()).min(1)
}).passthrough()

function removeJsonSchemaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeJsonSchemaMetadata)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema')
      .map(([key, nested]) => [key, removeJsonSchemaMetadata(nested)])
  )
}

const finalResponseJsonSchema = removeJsonSchemaMetadata(z.toJSONSchema(cppPilotFinalResponseSchema))

export function isDeepSeekApiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

export function deepSeekChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = 'https:'
  const pathname = url.pathname.replace(/\/$/, '')
  if (!pathname.endsWith('/chat/completions')) {
    url.pathname = `${pathname}/chat/completions`
  } else {
    url.pathname = pathname
  }
  return url.toString().replace(/\/$/, '')
}

function chatUserContent(content: unknown): unknown {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: string } }
  > = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.type === 'input_text' && typeof record.text === 'string') {
      parts.push({ type: 'text', text: record.text })
    }
    if (record.type === 'input_image' && typeof record.image_url === 'string') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: record.image_url,
          detail: typeof record.detail === 'string' ? record.detail : 'auto'
        }
      })
    }
  }
  if (parts.length === 1 && parts[0]?.type === 'text') return parts[0].text
  return parts
}

function responseMessageText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : []
  return content
    .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object')
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => String(part.text))
    .join('\n')
}

function toDeepSeekMessages(input: OpenAiResponseInputItem[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [{
    role: 'system',
    content: `${CPPPILOT_OPENAI_INSTRUCTIONS}\n\nRequired final JSON Schema:\n${JSON.stringify(finalResponseJsonSchema)}`
  }]

  for (const item of input) {
    if (item.role === 'user') {
      messages.push({ role: 'user', content: chatUserContent(item.content) })
      continue
    }
    if (item.type === 'function_call') {
      const previous = messages.at(-1)
      const assistant = previous?.role === 'assistant'
        ? previous
        : { role: 'assistant', content: null, tool_calls: [] }
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls as unknown[] : []
      calls.push({
        id: item.call_id,
        type: 'function',
        function: { name: item.name, arguments: item.arguments }
      })
      assistant.tool_calls = calls
      if (assistant !== previous) messages.push(assistant)
      continue
    }
    if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: String(item.output ?? '') })
      continue
    }
    if (item.type === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary : []
      const reasoningContent = summary
        .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object')
        .filter(part => typeof part.text === 'string')
        .map(part => String(part.text))
        .join('\n')
      if (!reasoningContent) continue
      const previous = messages.at(-1)
      if (previous?.role === 'assistant') previous.reasoning_content = reasoningContent
      else messages.push({ role: 'assistant', content: null, reasoning_content: reasoningContent })
      continue
    }
    if (item.type === 'message') {
      const text = responseMessageText(item)
      const previous = messages.at(-1)
      if (previous?.role === 'assistant') previous.content = text || previous.content || null
      else messages.push({ role: 'assistant', content: text })
    }
  }
  return messages
}

function deepSeekTools(tools: OpenAiFunctionTool[]): Record<string, unknown>[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

function invalidFields(error: z.ZodError): string {
  const fields = [...new Set(error.issues
    .map(issue => issue.path[0])
    .filter((field): field is string | number => typeof field === 'string' || typeof field === 'number')
    .map(String))]
  return fields.length ? ` (invalid or missing fields: ${fields.slice(0, 10).join(', ')})` : ''
}

function safeIncompleteReason(reason: string | undefined): string {
  return reason === 'max_output_tokens' || reason === 'content_filter' ? `: ${reason}` : ''
}

export class OpenAiResponsesClient {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: OpenAiResponsesClientOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  async respond(input: OpenAiResponseInputItem[], signal: AbortSignal): Promise<OpenAiResponsesResult> {
    if (isDeepSeekApiBaseUrl(this.options.profile.baseUrl)) {
      return this.respondWithDeepSeek(input, signal)
    }

    let response: Response
    try {
      response = await this.fetcher(`${this.options.profile.baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.profile.model,
          instructions: CPPPILOT_OPENAI_INSTRUCTIONS,
          input,
          tools: this.options.tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              name: 'cpppilot_final_response',
              strict: true,
              schema: finalResponseJsonSchema
            }
          }
        }),
        signal
      })
    } catch (error) {
      throw new OpenAiResponsesError('MODEL_REQUEST_FAILED', 'OpenAI Responses request failed', error)
    }

    if (!response.ok) {
      throw new OpenAiResponsesError(
        'MODEL_REQUEST_FAILED',
        `OpenAI Responses request failed with HTTP ${response.status}`
      )
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch (error) {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'OpenAI response was not valid JSON', error)
    }

    const envelope = responseEnvelopeSchema.safeParse(raw)
    if (!envelope.success) {
      throw new OpenAiResponsesError(
        'MODEL_PROTOCOL_INVALID',
        `OpenAI response envelope was invalid${invalidFields(envelope.error)}`,
        envelope.error
      )
    }
    if (envelope.data.status === 'incomplete') {
      throw new OpenAiResponsesError(
        'MODEL_INCOMPLETE',
        `OpenAI response was incomplete${safeIncompleteReason(envelope.data.incomplete_details?.reason)}`
      )
    }
    if (envelope.data.status !== 'completed') {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'Unexpected OpenAI response status')
    }

    const output = z.array(openAiResponseOutputItemSchema).safeParse(envelope.data.output)
    if (!output.success) {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'OpenAI response output was invalid', output.error)
    }

    return { id: envelope.data.id, status: 'completed', output: output.data }
  }

  private async respondWithDeepSeek(
    input: OpenAiResponseInputItem[],
    signal: AbortSignal
  ): Promise<OpenAiResponsesResult> {
    let response: Response
    try {
      response = await this.fetcher(deepSeekChatCompletionsUrl(this.options.profile.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.profile.model,
          messages: toDeepSeekMessages(input),
          tools: deepSeekTools(this.options.tools),
          tool_choice: 'auto',
          response_format: { type: 'json_object' },
          stream: false
        }),
        signal
      })
    } catch (error) {
      throw new OpenAiResponsesError('MODEL_REQUEST_FAILED', 'DeepSeek Chat Completions request failed', error)
    }

    if (!response.ok) {
      throw new OpenAiResponsesError(
        'MODEL_REQUEST_FAILED',
        `DeepSeek Chat Completions request failed with HTTP ${response.status}`
      )
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch (error) {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'DeepSeek response was not valid JSON', error)
    }

    const envelope = chatCompletionEnvelopeSchema.safeParse(raw)
    if (!envelope.success) {
      throw new OpenAiResponsesError(
        'MODEL_PROTOCOL_INVALID',
        `DeepSeek response envelope was invalid${invalidFields(envelope.error)}`,
        envelope.error
      )
    }
    const choice = envelope.data.choices[0]!
    if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') {
      throw new OpenAiResponsesError('MODEL_INCOMPLETE', `DeepSeek response was incomplete: ${choice.finish_reason}`)
    }

    const output: OpenAiResponseOutputItem[] = []
    const toolCall = choice.message.tool_calls?.[0]
    if (toolCall) {
      if (choice.message.reasoning_content) {
        output.push({
          type: 'reasoning',
          id: `${envelope.data.id}:reasoning`,
          summary: [{ type: 'summary_text', text: choice.message.reasoning_content }]
        })
      }
      output.push({
        type: 'function_call',
        id: toolCall.id,
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
        status: 'completed'
      })
    } else if (choice.message.refusal) {
      output.push({
        type: 'message',
        id: `${envelope.data.id}:message`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'refusal', refusal: choice.message.refusal }]
      })
    } else if (typeof choice.message.content === 'string' && choice.message.content.length) {
      output.push({
        type: 'message',
        id: `${envelope.data.id}:message`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: choice.message.content, annotations: [] }]
      })
    } else {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'DeepSeek returned neither content nor a tool call')
    }

    return { id: envelope.data.id, status: 'completed', output }
  }
}
