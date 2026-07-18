import { describe, expect, it } from 'vitest'
import {
  agentContinueRequestSchema,
  agentRunStatusSchema,
  cppPilotContextEnvelopeSchema,
  cppPilotFinalResponseSchema,
  cppPilotToolOutputSchema,
  conversationSendInputSchema,
  openAiFunctionToolSchema,
  openAiResponseOutputItemSchema
} from './index'

const taskId = crypto.randomUUID()
const projectId = crypto.randomUUID()

describe('OpenAI Responses Agent contracts', () => {
  it('validates bounded clarification continuations', () => {
    const runId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    expect(agentContinueRequestSchema.parse({ runId, message: 'main.cpp', assistantMessageId })).toEqual({ runId, message: 'main.cpp', assistantMessageId })
    expect(agentContinueRequestSchema.safeParse({ runId, message: '' }).success).toBe(false)
  })

  it('preserves original prompt bytes across conversation transport', () => {
    const prompt = '  原始 prompt 缺少"闭合  '
    const parsed = conversationSendInputSchema.parse({ projectId, conversationId: crypto.randomUUID(), message: prompt })
    expect(parsed.message).toBe(prompt)
    expect(agentContinueRequestSchema.parse({ runId: crypto.randomUUID(), message: prompt }).message).toBe(prompt)
  })

  it('validates a bounded context envelope with the unchanged prompt', () => {
    const prompt = '帮我把 main.cpp 中的"Hello"改成"world，然后编译'
    const context = cppPilotContextEnvelopeSchema.parse({
      protocol: 'cpppilot.context.v1', taskId, turn: 0,
      task: { prompt, source: 'workspace', activeFile: 'main.cpp' },
      workspace: {
        project: { id: projectId, name: 'demo', type: 'single-file' },
        activeFile: { path: 'main.cpp', content: 'int main() {}', contentHash: 'hash-1', dirty: false, truncated: false },
        relatedFiles: ['README.md'], diagnostics: [],
        environment: { cppStandard: 'c++17', compiler: 'gcc 14', cmakeAvailable: true }
      },
      memory: {
        recentConversation: [], learnerProfile: {}, knowledgeState: [],
        relevantErrors: [], dueReviews: [], recentEvidence: []
      },
      policy: {
        allowedProjectId: projectId, allowedPaths: ['main.cpp'], writesRequireApproval: true,
        maxModelTurns: 12, maxToolCalls: 20, remainingTimeMs: 120_000
      }
    })

    expect(context.task.prompt).toBe(prompt)
    expect(cppPilotContextEnvelopeSchema.safeParse({ ...context, unexpected: true }).success).toBe(false)
  })

  it('validates strict OpenAI functions and native output items', () => {
    const tool = openAiFunctionToolSchema.parse({
      type: 'function', name: 'workspace_read_file', description: 'Read a project file', strict: true,
      parameters: {
        type: 'object', properties: { projectId: { type: 'string' }, relativePath: { type: 'string' } },
        required: ['projectId', 'relativePath'], additionalProperties: false
      }
    })
    const call = openAiResponseOutputItemSchema.parse({
      type: 'function_call', id: 'fc_1', call_id: 'call_1', name: tool.name,
      arguments: JSON.stringify({ projectId, relativePath: 'main.cpp' }), status: 'completed'
    })
    const message = openAiResponseOutputItemSchema.parse({
      type: 'message', id: 'msg_1', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{"protocol":"cpppilot.final.v1"}', annotations: [] }]
    })

    expect(call.type).toBe('function_call')
    expect(message.type).toBe('message')
  })

  it('validates bounded evidence returned to the model', () => {
    const output = cppPilotToolOutputSchema.parse({
      protocol: 'cpppilot.tool-output.v1', taskId, callId: 'call_1', tool: 'compiler.build',
      ok: true, summary: '编译成功', exitCode: 0, diagnostics: [], artifacts: [], changedFiles: [],
      data: { content: 'int main() {}' }, retryable: false, durationMs: 30, outputTruncated: false
    })

    expect(output.ok).toBe(true)
    expect(output.data).toEqual({ content: 'int main() {}' })
    expect(cppPilotToolOutputSchema.safeParse({ ...output, secret: 'key' }).success).toBe(false)
  })

  it('requires valid completed, clarification, and failed final responses', () => {
    const completed = cppPilotFinalResponseSchema.parse({
      protocol: 'cpppilot.final.v1', taskId, status: 'completed',
      intent: { primary: 'edit_code', secondary: ['explain_code'] },
      messageMarkdown: '已修改并编译。', evidenceCallIds: ['call_1'], suggestedNextActions: []
    })
    const clarification = cppPilotFinalResponseSchema.parse({
      protocol: 'cpppilot.final.v1', taskId, status: 'needs_input',
      intent: { primary: 'edit_code', secondary: [] }, messageMarkdown: '请选择目标文件。',
      clarificationQuestion: '你要修改哪个文件？', evidenceCallIds: [], suggestedNextActions: []
    })

    expect(completed.status).toBe('completed')
    expect(clarification.status).toBe('needs_input')
    expect(cppPilotFinalResponseSchema.safeParse({ ...clarification, clarificationQuestion: undefined }).success).toBe(false)
    expect(cppPilotFinalResponseSchema.safeParse({ ...completed, status: 'unknown' }).success).toBe(false)
    expect(cppPilotFinalResponseSchema.safeParse({ ...completed, extra: true }).success).toBe(false)
  })

  it('exposes truthful model-loop run states', () => {
    for (const status of ['waiting-model-approval', 'model-requesting', 'validating-model-output', 'waiting-input']) {
      expect(agentRunStatusSchema.safeParse(status).success).toBe(true)
    }
  })
})
