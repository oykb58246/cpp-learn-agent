import { describe, expect, it } from 'vitest'
import type {
  AgentContinueRequest,
  CppPilotContextEnvelope,
  ModelProfile,
  OpenAiFunctionTool,
  OpenAiResponseOutputItem,
  ToolResult
} from '@cpp-pet/contracts'
import { InMemoryRuntimeStore, type RuntimeToolClient } from './runtime'
import {
  OpenAiAgentRuntime,
  type OpenAiAgentContextBuilder,
  type OpenAiAgentModel,
  type OpenAiAgentToolRegistry
} from './openai-runtime'

const projectId = crypto.randomUUID()
const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5',
  enabled: true, timeoutMs: 5_000, apiKeyConfigured: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}
const tool: OpenAiFunctionTool = {
  type: 'function', name: 'workspace_read_file', description: 'Read', strict: true,
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
}

function envelope(taskId: string, prompt: string, turn = 0): CppPilotContextEnvelope {
  return {
    protocol: 'cpppilot.context.v1', taskId, turn,
    task: { prompt, source: 'workspace', activeFile: 'main.cpp' },
    workspace: {
      project: { id: projectId, name: 'demo', type: 'single-file' },
      activeFile: { path: 'main.cpp', content: 'int main() {}', contentHash: 'hash', dirty: false, truncated: false },
      relatedFiles: ['main.cpp'], diagnostics: [],
      environment: { cppStandard: 'c++17', cmakeAvailable: false }
    },
    memory: { recentConversation: [], learnerProfile: {}, knowledgeState: [], relevantErrors: [], dueReviews: [], recentEvidence: [] },
    policy: {
      allowedProjectId: projectId, allowedPaths: ['main.cpp'], writesRequireApproval: true,
      maxModelTurns: 8, maxToolCalls: 8, remainingTimeMs: 30_000
    }
  }
}

function functionCall(callId: string, name: string, args: Record<string, unknown>): OpenAiResponseOutputItem {
  return { type: 'function_call', id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: 'completed' }
}

function final(taskId: string, status: 'completed' | 'needs_input' | 'failed', evidenceCallIds: string[] = []): OpenAiResponseOutputItem {
  return {
    type: 'message', id: `msg_${crypto.randomUUID()}`, role: 'assistant', status: 'completed',
    content: [{
      type: 'output_text', annotations: [], text: JSON.stringify({
        protocol: 'cpppilot.final.v1', taskId, status,
        intent: { primary: status === 'completed' ? 'answer' : 'diagnose_error', secondary: [] },
        messageMarkdown: status === 'completed' ? '完成' : status === 'needs_input' ? '需要补充信息' : '无法完成',
        ...(status === 'needs_input' ? { clarificationQuestion: '目标文件是哪一个？' } : {}),
        evidenceCallIds, suggestedNextActions: []
      })
    }]
  }
}

function success(changedFiles: string[] = []): ToolResult {
  return {
    ok: true, exitCode: 0, summary: 'tool ok', structuredContent: { content: 'int main() {}' }, diagnostics: [], artifacts: [],
    sideEffects: changedFiles.map(target => ({ kind: 'write-file' as const, target, summary: 'changed' })),
    retryable: false, durationMs: 2
  }
}

function createHarness(outputs: OpenAiResponseOutputItem[][], options: {
  risk?: 'L0' | 'L2'
  toolName?: string
  toolResult?: ToolResult
  modelConfigured?: boolean
  parseErrorOnce?: boolean
} = {}) {
  const requests: Record<string, unknown>[][] = []
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const model: OpenAiAgentModel = {
    profile,
    tools: [tool],
    async respond(input) {
      requests.push(structuredClone(input))
      const output = outputs.shift()
      if (!output) throw new Error('No fake model output')
      return { id: crypto.randomUUID(), status: 'completed', output }
    }
  }
  const contextBuilder: OpenAiAgentContextBuilder = {
    async build(request, runId, turn) { return envelope(runId, request.message, turn) }
  }
  const registry: OpenAiAgentToolRegistry = {
    tools: [tool],
    resolve(name) {
      if (name !== (options.toolName ?? 'workspace_read_file')) return undefined
      return { name: name.replaceAll('_', '.'), title: name, description: name, risk: options.risk ?? 'L0', timeoutMs: 1_000 }
    },
    parse(name, raw) {
      if (name !== (options.toolName ?? 'workspace_read_file')) throw new Error(`Unknown OpenAI function: ${name}`)
      if (options.parseErrorOnce) { options.parseErrorOnce = false; throw new Error('relativePath is required') }
      return {
        definition: {
          name: name.replaceAll('_', '.'), title: name, description: name,
          risk: options.risk ?? 'L0', timeoutMs: 1_000
        },
        arguments: raw as Record<string, unknown>
      }
    }
  }
  const toolClient: RuntimeToolClient = {
    async call(name, args) { calls.push({ name, args }); return options.toolResult ?? success() }
  }
  const runtime = new OpenAiAgentRuntime({
    store: new InMemoryRuntimeStore(), contextBuilder, registry, toolClient,
    modelFactory: { async create() { return options.modelConfigured === false ? undefined : model } },
    totalTimeoutMs: 30_000
  })
  return { runtime, requests, calls }
}

async function approveRemote(runtime: OpenAiAgentRuntime, run: Awaited<ReturnType<OpenAiAgentRuntime['start']>>) {
  expect(run.status).toBe('waiting-model-approval')
  return runtime.decide({ approvalId: run.pendingApproval!.id, decision: 'approved' })
}

describe('OpenAiAgentRuntime', () => {
  it('preserves the original prompt and returns tool evidence by the original call id', async () => {
    const prompt = '把 "Hello, C++Pilot!" 改成 "Hello, world!，然后编译'
    const requestId = crypto.randomUUID()
    const { runtime, requests, calls } = createHarness([
      [functionCall('call_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [final(requestId, 'completed', ['call_read'])]
    ])

    const waiting = await runtime.start({ requestId, source: 'main', mode: 'auto', message: prompt, projectId, activeFile: 'main.cpp' })
    const run = await approveRemote(runtime, waiting)

    expect(run.status).toBe('completed')
    expect(calls).toEqual([{ name: 'workspace.read.file', args: { projectId, relativePath: 'main.cpp' } }])
    const firstContext = JSON.parse((requests[0]?.[0] as any).content[0].text)
    expect(firstContext.task.prompt).toBe(prompt)
    expect(requests[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call_read' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_read' })
    ]))
    const observation = requests[1]?.find(item => item.type === 'function_call_output')
    expect(JSON.parse(String(observation?.output))).toMatchObject({ data: { content: 'int main() {}' } })
  })

  it('pauses an L2 call for approval and resumes that exact call', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests, calls } = createHarness([
      [functionCall('call_write', 'workspace_apply_patch', { projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed' })],
      [final(requestId, 'completed', ['call_write'])]
    ], { risk: 'L2', toolName: 'workspace_apply_patch', toolResult: success(['main.cpp']) })

    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(runtime, initial)

    expect(waiting.status).toBe('waiting-approval')
    expect(calls).toHaveLength(0)
    const run = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' })
    expect(run.status).toBe('completed')
    expect(calls).toHaveLength(1)
    expect(requests[1]).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function_call_output', call_id: 'call_write' })]))
  })

  it('returns a rejected tool call to the model instead of pretending it ran', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests, calls } = createHarness([
      [functionCall('call_write', 'workspace_apply_patch', { projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed' })],
      [final(requestId, 'failed')]
    ], { risk: 'L2', toolName: 'workspace_apply_patch' })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(runtime, initial)

    const run = await runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'rejected', reason: '不要修改' })

    expect(run.status).toBe('failed')
    expect(calls).toHaveLength(0)
    const observation = requests[1]?.find(item => item.type === 'function_call_output')
    expect(JSON.parse(String(observation?.output))).toMatchObject({ callId: 'call_write', ok: false, errorCode: 'TOOL_REJECTED' })
  })

  it('waits for clarification and continues the same run with the user answer', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([[final(requestId, 'needs_input')], [final(requestId, 'completed')]])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '帮我改一下', projectId })
    const waiting = await approveRemote(runtime, initial)
    expect(waiting.status).toBe('waiting-input')
    expect(waiting.pendingClarification?.question).toBe('目标文件是哪一个？')

    const continuation: AgentContinueRequest = { runId: waiting.id, message: 'main.cpp' }
    const run = await runtime.continue(continuation)

    expect(run.id).toBe(waiting.id)
    expect(run.status).toBe('completed')
    expect(requests[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: [expect.objectContaining({ type: 'input_text', text: 'main.cpp' })] })
    ]))
  })

  it('fails explicitly when no model is configured or model evidence is invalid', async () => {
    const noModel = createHarness([], { modelConfigured: false }).runtime
    const missing = await noModel.start({ source: 'main', mode: 'auto', message: '解释代码' })
    expect(missing).toMatchObject({ status: 'failed', errorCode: 'MODEL_NOT_CONFIGURED' })

    const requestId = crypto.randomUUID()
    const invalid = createHarness([[final(requestId, 'completed', ['missing_call'])]]).runtime
    const initial = await invalid.start({ requestId, source: 'main', mode: 'auto', message: '解释代码' })
    const failed = await approveRemote(invalid, initial)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_EVIDENCE_INVALID' })
  })

  it('does not execute unknown functions', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([[functionCall('call_bad', 'not_registered', {})]])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: 'do it' })
    const failed = await approveRemote(runtime, initial)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROTOCOL_INVALID' })
    expect(calls).toHaveLength(0)
  })

  it('returns known-tool argument errors to the model for correction', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests, calls } = createHarness([
      [functionCall('call_invalid', 'workspace_read_file', { projectId })],
      [final(requestId, 'failed')]
    ], { parseErrorOnce: true })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '读取文件', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed.errorCode).toBe('MODEL_REPORTED_FAILURE')
    expect(calls).toHaveLength(0)
    const observation = requests[1]?.find(item => item.type === 'function_call_output')
    expect(JSON.parse(String(observation?.output))).toMatchObject({ callId: 'call_invalid', ok: false, errorCode: 'TOOL_ARGUMENT_INVALID' })
  })

  it('allows one repair turn for malformed final JSON', async () => {
    const requestId = crypto.randomUUID()
    const malformed: OpenAiResponseOutputItem = {
      type: 'message', id: 'msg_bad', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{bad json', annotations: [] }]
    }
    const { runtime, requests } = createHarness([[malformed], [final(requestId, 'completed')]])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '解释代码' })

    const run = await approveRemote(runtime, initial)

    expect(run.status).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: [expect.objectContaining({ type: 'input_text', text: expect.stringContaining('cpppilot.final.v1') })] })
    ]))
  })
})
