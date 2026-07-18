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
  incomplete_details: z.object({ reason: z.string().optional() }).passthrough().optional()
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

export class OpenAiResponsesClient {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: OpenAiResponsesClientOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  async respond(input: OpenAiResponseInputItem[], signal: AbortSignal): Promise<OpenAiResponsesResult> {
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
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'OpenAI response envelope was invalid', envelope.error)
    }
    if (envelope.data.status === 'incomplete') {
      const reason = envelope.data.incomplete_details?.reason
      throw new OpenAiResponsesError('MODEL_INCOMPLETE', `OpenAI response was incomplete${reason ? `: ${reason}` : ''}`)
    }
    if (envelope.data.status !== 'completed') {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', `Unexpected OpenAI response status: ${envelope.data.status}`)
    }

    const output = z.array(openAiResponseOutputItemSchema).safeParse(envelope.data.output)
    if (!output.success) {
      throw new OpenAiResponsesError('MODEL_PROTOCOL_INVALID', 'OpenAI response output was invalid', output.error)
    }

    return { id: envelope.data.id, status: 'completed', output: output.data }
  }
}
