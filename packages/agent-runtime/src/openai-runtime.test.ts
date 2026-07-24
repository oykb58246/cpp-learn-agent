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
const workspaceId = crypto.randomUUID()
const profile: ModelProfile = {
  id: crypto.randomUUID(), name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5',
  provider: 'openai', protocol: 'openai-responses',
  capabilities: { text: true, vision: true, toolCalling: true, structuredOutput: true },
  enabled: true, timeoutMs: 5_000, apiKeyConfigured: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}
function advertisedTool(name: string): OpenAiFunctionTool {
  return {
    type: 'function', name, description: name, strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
}

function envelope(taskId: string, prompt: string, turn = 0): CppPilotContextEnvelope {
  return {
    protocol: 'cpppilot.context.v1', taskId, turn,
    task: { prompt, source: 'workspace', activeFile: 'main.cpp' },
    workspace: {
      project: { id: projectId, workspaceId, name: 'demo', type: 'single-file' },
      activeFile: { path: 'main.cpp', content: 'int main() {}', contentHash: 'hash', dirty: false, truncated: false, redacted: false },
      relatedFiles: ['main.cpp'], diagnostics: [],
      environment: { cppStandard: 'c++17', cmakeAvailable: false }
    },
    memory: { recentConversation: [], learnerProfile: {}, knowledgeState: [], relevantErrors: [], dueReviews: [], recentEvidence: [] },
    policy: {
      allowedProjectId: projectId, allowedWorkspaceId: workspaceId, allowedPaths: ['main.cpp'], writesRequireApproval: true, approvalMode: 'on-risk',
      allowNewPaths: true,
      maxModelTurns: 8, maxToolCalls: 8, remainingTimeMs: 30_000
    }
  }
}

function functionCall(callId: string, name: string, args: Record<string, unknown>): OpenAiResponseOutputItem {
  return { type: 'function_call', id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: 'completed' }
}

function final(
  taskId: string,
  status: 'completed' | 'needs_input' | 'failed',
  evidenceCallIds: string[] = [],
  options: {
    primary?: 'answer' | 'explain_code' | 'diagnose_error' | 'edit_code' | 'review_code' | 'create_project' | 'environment_setup'
    claims?: Array<{ type: string; callId: string; target: string | null }>
  } = {}
): OpenAiResponseOutputItem {
  return {
    type: 'message', id: `msg_${crypto.randomUUID()}`, role: 'assistant', status: 'completed',
    content: [{
      type: 'output_text', annotations: [], text: JSON.stringify({
        protocol: 'cpppilot.final.v1', taskId, status,
        intent: { primary: options.primary ?? (status === 'completed' ? 'answer' : 'diagnose_error'), secondary: [] },
        messageMarkdown: status === 'completed' ? '完成' : status === 'needs_input' ? '需要补充信息' : '无法完成',
        clarificationQuestion: status === 'needs_input' ? '目标文件是哪一个？' : null,
        evidenceCallIds, claims: options.claims ?? [], suggestedNextActions: []
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
  advertisedToolNames?: string[]
  registeredToolNames?: string[]
  risks?: Record<string, 'L0' | 'L2'>
  allowedPaths?: string[]
  toolResult?: ToolResult
  toolResults?: ToolResult[]
  toolErrorOnce?: Error
  modelConfigured?: boolean
  parseErrorOnce?: boolean
  store?: InMemoryRuntimeStore
  profile?: ModelProfile
  responseDelayMs?: number
  totalTimeoutMs?: number
  maxSessionItems?: number
  maxSessionBytes?: number
  approvalMode?: 'always' | 'on-risk' | 'full'
} = {}) {
  const requests: Record<string, unknown>[][] = []
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const registeredToolNames = options.registeredToolNames ?? [options.toolName ?? 'workspace_read_file']
  const advertisedToolNames = options.advertisedToolNames ?? registeredToolNames
  const runtimeManagedRunIdTools = new Set([
    'compiler_build', 'program_run', 'program_stop', 'cmake_build',
    'ctest_run', 'analysis_clang_tidy', 'tests_run_cases'
  ])
  const model: OpenAiAgentModel = {
    profile: options.profile ?? profile,
    tools: advertisedToolNames.map(advertisedTool),
    async respond(input) {
      requests.push(structuredClone(input))
      if (options.responseDelayMs) await new Promise(resolve => setTimeout(resolve, options.responseDelayMs))
      const output = outputs.shift()
      if (!output) throw new Error('No fake model output')
      return { id: crypto.randomUUID(), status: 'completed', output }
    }
  }
  const contextBuilder: OpenAiAgentContextBuilder = {
    async build(request, runId, turn) {
      const context = envelope(runId, request.message, turn)
      context.policy.allowedPaths = options.allowedPaths ?? context.policy.allowedPaths
      if (options.approvalMode) {
        context.policy.approvalMode = options.approvalMode
        context.policy.writesRequireApproval = options.approvalMode !== 'full'
      }
      return context
    }
  }
  const registry: OpenAiAgentToolRegistry = {
    tools: registeredToolNames.map(advertisedTool),
    resolve(name) {
      if (!registeredToolNames.includes(name)) return undefined
      return {
        name: name.replaceAll('_', '.'), title: name, description: name,
        risk: options.risks?.[name] ?? options.risk ?? 'L0', timeoutMs: 1_000
      }
    },
    parse(name, raw, bindings?: { runId: string }) {
      if (!registeredToolNames.includes(name)) throw new Error(`Unknown OpenAI function: ${name}`)
      if (options.parseErrorOnce) { options.parseErrorOnce = false; throw new Error('relativePath is required') }
      const args = { ...(raw as Record<string, unknown>) }
      if (runtimeManagedRunIdTools.has(name)) {
        if (!bindings?.runId) throw new Error('Missing runtime runId binding')
        args.runId = bindings.runId
      }
      return {
        definition: {
          name: name.replaceAll('_', '.'), title: name, description: name,
          risk: options.risks?.[name] ?? options.risk ?? 'L0', timeoutMs: 1_000
        },
        arguments: args
      }
    }
  }
  const toolClient: RuntimeToolClient = {
    async call(name, args) {
      calls.push({ name, args })
      if (options.toolErrorOnce) {
        const error = options.toolErrorOnce
        delete options.toolErrorOnce
        throw error
      }
      return options.toolResults?.shift() ?? options.toolResult ?? success()
    }
  }
  const store = options.store ?? new InMemoryRuntimeStore()
  const runtime = new OpenAiAgentRuntime({
    store, contextBuilder, registry, toolClient,
    modelFactory: { async create() { return options.modelConfigured === false ? undefined : model } },
    totalTimeoutMs: options.totalTimeoutMs ?? 30_000,
    ...(options.maxSessionItems === undefined ? {} : { maxSessionItems: options.maxSessionItems }),
    ...(options.maxSessionBytes === undefined ? {} : { maxSessionBytes: options.maxSessionBytes })
  })
  return { runtime, requests, calls, store }
}

async function approveRemote(runtime: OpenAiAgentRuntime, run: Awaited<ReturnType<OpenAiAgentRuntime['start']>>) {
  expect(run.status).toBe('waiting-model-approval')
  return runtime.decide({ approvalId: run.pendingApproval!.id, decision: 'approved' })
}

describe('OpenAiAgentRuntime', () => {
  it('describes the complete remote context boundary before requesting approval', async () => {
    const requestId = crypto.randomUUID()
    const prompt = '解释当前代码'
    const { runtime } = createHarness([])

    const waiting = await runtime.start({ requestId, source: 'main', mode: 'auto', message: prompt, projectId })

    expect(waiting.pendingApproval?.parameterSummary).toMatchObject({
      endpoint: 'https://api.openai.com/v1/responses',
      model: 'gpt-5',
      toolCount: 1,
      contextBytes: expect.any(Number),
      diagnostics: { count: 0, sources: [] },
      memory: {
        recentConversation: 0,
        learnerProfileFields: 0,
        knowledgeState: 0,
        relevantErrors: 0,
        dueReviews: 0,
        recentEvidence: 0
      }
    })
  })

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

  it('rejects a write narrative without tool calls and continues with tools', async () => {
    const requestId = crypto.randomUUID()
    const narrative: OpenAiResponseOutputItem = {
      type: 'message', id: 'msg_story', role: 'assistant', status: 'completed',
      content: [{
        type: 'output_text', annotations: [],
        text: JSON.stringify({
          protocol: 'cpppilot.final.v1', taskId: requestId, status: 'completed',
          intent: { primary: 'edit_code', secondary: [] },
          messageMarkdown: '???????????????? main.cpp?',
          clarificationQuestion: null, evidenceCallIds: [], claims: [], suggestedNextActions: []
        })
      }]
    }
    const { runtime, calls, requests } = createHarness([
      [narrative],
      [functionCall('call_write', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'int main(){return 0;}'
      })],
      [final(requestId, 'completed', ['call_write'], {
        primary: 'edit_code',
        claims: [{ type: 'file_changed', callId: 'call_write', target: 'main.cpp' }]
      })]
    ], {
      approvalMode: 'full',
      risks: { workspace_apply_patch: 'L0' },
      toolName: 'workspace_apply_patch',
      toolResult: success(['main.cpp']),
      registeredToolNames: ['workspace_apply_patch']
    })
    const run = await runtime.start({
      requestId, source: 'editor', mode: 'auto', message: '??????????', projectId, activeFile: 'main.cpp'
    })
    expect(run.status).toBe('completed')
    expect(calls.length).toBeGreaterThan(0)
    expect(requests.length).toBeGreaterThanOrEqual(2)
  })

  it('prefers a function call when the model also returns a message in the same turn', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [
        functionCall('call_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' }),
        final(requestId, 'completed')
      ],
      [final(requestId, 'completed', ['call_read'])]
    ], { approvalMode: 'full' })
    const run = await runtime.start({
      requestId, source: 'main', mode: 'auto', message: '????????????', projectId, activeFile: 'main.cpp'
    })
    expect(run.status).toBe('completed')
    expect(calls[0]?.name).toBe('workspace.read.file')
  })

  it('full approval mode still sends cppilot.context.v1 to the model', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([[final(requestId, 'completed')]], { approvalMode: 'full' })
    const run = await runtime.start({ requestId, source: 'main', mode: 'chat', message: '?????' })
    expect(run.status).toBe('completed')
    expect(requests).toHaveLength(1)
    const contextMessage = requests[0]?.find(item => item.role === 'user') as any
    expect(contextMessage).toBeTruthy()
    const payload = JSON.parse(String(contextMessage.content[0].text))
    expect(payload).toMatchObject({ protocol: 'cpppilot.context.v1', taskId: requestId })
    expect(payload.task.prompt).toBe('?????')
  })

  it('coerces a wrong final taskId to the current request id', async () => {
    const requestId = crypto.randomUUID()
    const wrongTaskId = crypto.randomUUID()
    const { runtime } = createHarness([[final(wrongTaskId, 'completed')]])
    const waiting = await runtime.start({ requestId, source: 'main', mode: 'chat', message: '你好' })
    const run = await approveRemote(runtime, waiting)
    expect(run.status).toBe('completed')
    expect(run.response).toBeTruthy()
  })

  it('sends an approved screenshot as a native Responses input image', async () => {
    const requestId = crypto.randomUUID()
    const screenshot = {
      id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png' as const, width: 320, height: 200, createdAt: new Date().toISOString()
    }
    const { runtime, requests } = createHarness([[final(requestId, 'completed')]])

    const initial = await runtime.start({
      requestId, source: 'screenshot', mode: 'auto', message: '分析这张截图', screenshot
    })
    await approveRemote(runtime, initial)

    const contextMessage = requests[0]?.find(item => item.role === 'user') as any
    expect(contextMessage.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: screenshot.previewDataUrl })
    ]))
    expect(contextMessage.content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_text', text: screenshot.previewDataUrl })
    ]))
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

  it('expires a pending approval and cancels unfinished steps when the run is cancelled', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, store } = createHarness([[
      functionCall('call_write', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })
    ]], { risk: 'L2', toolName: 'workspace_apply_patch' })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(runtime, initial)

    const cancelled = await runtime.cancel(waiting.id)
    const detail = store.get(waiting.id)

    expect(cancelled).toMatchObject({ status: 'cancelled', pendingApproval: undefined })
    expect(cancelled.steps).toEqual([
      expect.objectContaining({ status: 'cancelled', finishedAt: expect.any(String) })
    ])
    expect(detail?.approvals.at(-1)).toMatchObject({
      id: waiting.pendingApproval!.id,
      status: 'expired',
      decisionReason: 'Agent run cancelled',
      decidedAt: expect.any(String)
    })
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

  it('restores a waiting-input session and continues the same run after restart', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const first = createHarness([[final(requestId, 'needs_input')]], { store })
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: '帮我改一下', projectId })
    const waiting = await approveRemote(first.runtime, initial)
    expect(store.getSession(waiting.id)).toBeDefined()

    const resumed = createHarness([[final(requestId, 'completed')]], { store })
    expect(await resumed.runtime.restore()).toEqual([waiting.id])
    const completed = await resumed.runtime.continue({ runId: waiting.id, message: 'main.cpp' })

    expect(completed).toMatchObject({ id: waiting.id, requestId, status: 'completed' })
    expect(resumed.requests[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: [expect.objectContaining({ type: 'input_text', text: 'main.cpp' })] })
    ]))
    expect(store.getSession(waiting.id)).toBeUndefined()
  })

  it('restores and executes the exact approved function call after restart', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const options = {
      store,
      risk: 'L2' as const,
      toolName: 'workspace_apply_patch',
      toolResult: success(['main.cpp'])
    }
    const first = createHarness([[
      functionCall('call_persisted', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })
    ]], options)
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(first.runtime, initial)
    expect(waiting.status).toBe('waiting-approval')

    const resumed = createHarness([[final(requestId, 'completed', ['call_persisted'])]], options)
    expect(await resumed.runtime.restore()).toEqual([waiting.id])
    const completed = await resumed.runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' })

    expect(completed.status).toBe('completed')
    expect(resumed.calls).toEqual([{
      name: 'workspace.apply.patch',
      args: { projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed' }
    }])
    expect(resumed.requests[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call_persisted' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_persisted' })
    ]))
  })

  it('restores a pending call with the same runtime-managed runId', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const options = { store, risk: 'L2' as const, toolName: 'tests_run_cases' }
    const first = createHarness([[
      functionCall('call_cases', 'tests_run_cases', {
        projectId,
        relativePath: 'main.cpp',
        cases: [{ input: '', expectedOutput: 'ok' }]
      })
    ]], options)
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: 'run tests', projectId })
    const waiting = await approveRemote(first.runtime, initial)
    expect(waiting.pendingApproval?.parameterSummary).toMatchObject({ runId: waiting.id })

    const resumed = createHarness([[final(requestId, 'completed', ['call_cases'])]], options)
    expect(await resumed.runtime.restore()).toEqual([waiting.id])
    const completed = await resumed.runtime.decide({
      approvalId: waiting.pendingApproval!.id,
      decision: 'approved'
    })

    expect(completed.status).toBe('completed')
    expect(resumed.calls).toEqual([{
      name: 'tests.run.cases',
      args: {
        runId: waiting.id,
        projectId,
        relativePath: 'main.cpp',
        cases: [{ input: '', expectedOutput: 'ok' }]
      }
    }])
  })

  it('preserves resumable waiting sessions during an orderly shutdown', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const { runtime } = createHarness([[final(requestId, 'needs_input')]], { store })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '帮我改一下', projectId })
    const waiting = await approveRemote(runtime, initial)

    await runtime.shutdown()

    expect(store.get(waiting.id)).toMatchObject({ status: 'waiting-input' })
    expect(store.getSession(waiting.id)).toBeDefined()
  })

  it('does not charge remote or tool approval waits against the active deadline', async () => {
    const requestId = crypto.randomUUID()
    const { runtime } = createHarness([
      [functionCall('call_wait', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })],
      [final(requestId, 'completed', ['call_wait'])]
    ], {
      risk: 'L2', toolName: 'workspace_apply_patch', toolResult: success(['main.cpp']), totalTimeoutMs: 100
    })
    const remoteApproval = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    await new Promise(resolve => setTimeout(resolve, 140))
    const toolApproval = await runtime.decide({ approvalId: remoteApproval.pendingApproval!.id, decision: 'approved' })
    expect(toolApproval.status).toBe('waiting-approval')

    await new Promise(resolve => setTimeout(resolve, 140))
    const completed = await runtime.decide({ approvalId: toolApproval.pendingApproval!.id, decision: 'approved' })

    expect(completed.status).toBe('completed')
  })

  it('does not charge clarification waits against the active deadline', async () => {
    const requestId = crypto.randomUUID()
    const { runtime } = createHarness([
      [final(requestId, 'needs_input')],
      [final(requestId, 'completed')]
    ], { totalTimeoutMs: 100 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(runtime, initial)
    expect(waiting.status).toBe('waiting-input')

    await new Promise(resolve => setTimeout(resolve, 140))
    const completed = await runtime.continue({ runId: waiting.id, message: 'main.cpp' })

    expect(completed.status).toBe('completed')
  })

  it('uses the model profile timeout even when the request ignores cancellation', async () => {
    const requestId = crypto.randomUUID()
    const { runtime } = createHarness([[final(requestId, 'completed')]], {
      profile: { ...profile, timeoutMs: 20 },
      responseDelayMs: 80,
      totalTimeoutMs: 1_000
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '解释代码' })

    const failed = await runtime.decide({ approvalId: initial.pendingApproval!.id, decision: 'approved' })

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_TIMEOUT' })
  })

  it('fails explicitly instead of trimming paired session items', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })]
    ], { maxSessionItems: 2 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '读取后回答', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(calls).toHaveLength(1)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SESSION_ITEM_LIMIT' })
  })

  it('enforces a UTF-8 byte limit before sending model context', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([], { maxSessionBytes: 64 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '包含中文的模型上下文' })

    const failed = await runtime.decide({ approvalId: initial.pendingApproval!.id, decision: 'approved' })

    expect(requests).toHaveLength(0)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SESSION_BYTE_LIMIT' })
  })

  it('detects the same failed tool call even when the model changes call_id', async () => {
    const requestId = crypto.randomUUID()
    const failedTool: ToolResult = {
      ok: false,
      exitCode: 1,
      summary: 'build failed',
      diagnostics: [],
      artifacts: [],
      sideEffects: [],
      retryable: true,
      errorCode: 'BUILD_FAILED',
      durationMs: 2
    }
    const { runtime, calls, requests } = createHarness([
      [functionCall('call_fail_1', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [functionCall('call_fail_2', 'workspace_read_file', { relativePath: 'main.cpp', projectId })]
    ], { toolResult: failedTool })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修复构建', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(calls).toHaveLength(2)
    expect(requests).toHaveLength(2)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'AGENT_LOOP_DETECTED' })
  })

  it('returns an MCP transport failure as a matching observation so the model can recover', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([
      [functionCall('call_transport', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [final(requestId, 'failed')]
    ], { toolErrorOnce: new Error('transport closed') })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '读取文件', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_REPORTED_FAILURE' })
    const observation = requests[1]?.find(item => item.type === 'function_call_output')
    expect(JSON.parse(String(observation?.output))).toMatchObject({
      callId: 'call_transport', ok: false, errorCode: 'MCP_CALL_FAILED', retryable: true
    })
  })

  it.each(['in_progress', 'incomplete'] as const)('rejects a %s function call output item', async status => {
    const requestId = crypto.randomUUID()
    const unsettled = { ...functionCall('call_unsettled', 'workspace_read_file', { projectId, relativePath: 'main.cpp' }), status }
    const { runtime, calls } = createHarness([[unsettled]])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '读取文件', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROTOCOL_INVALID' })
    expect(calls).toHaveLength(0)
  })

  it.each(['in_progress', 'incomplete'] as const)('rejects a %s final message output item', async status => {
    const requestId = crypto.randomUUID()
    const unsettled = { ...final(requestId, 'completed'), status }
    const { runtime } = createHarness([[unsettled]])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '解释代码' })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROTOCOL_INVALID' })
  })

  it('redacts local paths and secrets from every model-visible tool output field', async () => {
    const requestId = crypto.randomUUID()
    const sensitiveResult: ToolResult = {
      ok: true,
      exitCode: 0,
      summary: 'Built C:\\Users\\alice\\project\\app.exe with sk-sensitive-token-value',
      diagnostics: [{
        source: 'compiler', severity: 'warning', rawMessage: 'included from /home/alice/project/main.cpp',
        normalizedMessage: 'included from /home/alice/project/main.cpp', relatedConceptIds: []
      }],
      artifacts: [{ id: 'C:\\build\\app.exe', kind: 'build', label: '/tmp/build/app.exe' }],
      sideEffects: [],
      structuredContent: {
        stdout: 'loaded /private/tmp/app and C:\\Users\\alice\\data.txt',
        content: 'int average = total/count; //comment\nstd::string url = "https://example.test/docs";\n#include "/home/alice/private.hpp"',
        apiKey: 'secret-api-value',
        authorization: 'Bearer private-token'
      },
      retryable: false,
      durationMs: 2
    }
    const { runtime, requests } = createHarness([
      [functionCall('call_sensitive', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [final(requestId, 'completed', ['call_sensitive'])]
    ], { toolResult: sensitiveResult })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '构建程序', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    const serialized = JSON.stringify(requests[1]?.find(item => item.type === 'function_call_output'))
    expect(serialized).not.toContain('C:\\Users\\alice')
    expect(serialized).not.toContain('/home/alice')
    expect(serialized).not.toContain('/private/tmp')
    expect(serialized).not.toContain('sk-sensitive-token-value')
    expect(serialized).not.toContain('secret-api-value')
    expect(serialized).not.toContain('private-token')
    expect(serialized).toContain('total/count')
    expect(serialized).toContain('//comment')
    expect(serialized).toContain('https://example.test/docs')
    expect(serialized).toContain('[local path redacted]')
    expect(serialized).toContain('[redacted]')
  })

  it('binds runtime-managed runId without requiring the model to provide it', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_build', 'compiler_build', {
        projectId, relativePath: 'main.cpp', standard: 'c++17'
      })],
      [final(requestId, 'completed', ['call_build'])]
    ], { registeredToolNames: ['compiler_build'] })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: 'compile', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    expect(initial.id).not.toBe(requestId)
    expect(calls).toEqual([{
      name: 'compiler.build',
      args: { runId: initial.id, projectId, relativePath: 'main.cpp', standard: 'c++17' }
    }])
  })

  it('accepts action claims only when they match locally derived tool outcomes', async () => {
    const requestId = crypto.randomUUID()
    const claims = [
      { type: 'file_changed', callId: 'call_patch', target: 'main.cpp' },
      { type: 'build_succeeded', callId: 'call_build', target: 'main.cpp' }
    ]
    const { runtime, requests } = createHarness([
      [functionCall('call_patch', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })],
      [functionCall('call_build', 'compiler_build', {
        projectId, relativePath: 'main.cpp', standard: 'c++17'
      })],
      [final(requestId, 'completed', ['call_patch', 'call_build'], { primary: 'edit_code', claims })]
    ], {
      registeredToolNames: ['workspace_apply_patch', 'compiler_build'],
      toolResults: [success(['main.cpp']), success()]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改并编译', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    const observations = requests.flatMap(request => request.filter(item => item.type === 'function_call_output'))
      .map(item => JSON.parse(String(item.output)))
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: 'call_patch', outcomes: [{ type: 'file_changed', target: 'main.cpp' }] }),
      expect.objectContaining({ callId: 'call_build', outcomes: [{ type: 'build_succeeded', target: 'main.cpp' }] })
    ]))
  })

  it('rejects a completed action claim that is not backed by a matching local outcome', async () => {
    const requestId = crypto.randomUUID()
    const invalidFinal = final(requestId, 'completed', ['call_read'], {
      primary: 'edit_code',
      claims: [{ type: 'file_changed', callId: 'call_read', target: 'main.cpp' }]
    })
    const { runtime } = createHarness([
      [functionCall('call_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [invalidFinal],
      [invalidFinal]
    ])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_EVIDENCE_INVALID' })
  })

  it('fails explicitly when no model is configured or model evidence is invalid', async () => {
    const noModel = createHarness([], { modelConfigured: false }).runtime
    const missing = await noModel.start({ source: 'main', mode: 'auto', message: '解释代码' })
    expect(missing).toMatchObject({ status: 'failed', errorCode: 'MODEL_NOT_CONFIGURED' })

    const requestId = crypto.randomUUID()
    const invalidEvidence = final(requestId, 'completed', ['missing_call'])
    const invalid = createHarness([[invalidEvidence], [invalidEvidence]]).runtime
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

  it('does not execute a registered function that was not advertised to the model', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_hidden', 'workspace_apply_patch', { projectId, relativePath: 'main.cpp' })]
    ], {
      registeredToolNames: ['workspace_read_file', 'workspace_apply_patch'],
      advertisedToolNames: ['workspace_read_file']
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: 'do it', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROTOCOL_INVALID' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['projectId', { nested: { projectId: crypto.randomUUID() } }],
    ['runId', { nested: [{ runId: crypto.randomUUID() }] }],
    ['relativePath', { nested: { breakpoints: [{ relativePath: 'private/secret.cpp' }] } }],
    ['path', { nested: [{ path: 'private/secret.cpp' }] }]
  ])('rejects an unauthorized nested %s before MCP execution', async (_field, nestedArguments) => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_nested', 'workspace_read_file', {
        projectId,
        relativePath: 'main.cpp',
        nestedArguments
      })]
    ])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: 'do it', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'TOOL_POLICY_VIOLATION' })
    expect(calls).toHaveLength(0)
  })

  it('normalizes path separators but requires every path to exactly match allowedPaths', async () => {
    const requestId = crypto.randomUUID()
    const allowed = createHarness([
      [functionCall('call_allowed', 'workspace_read_file', { projectId, relativePath: 'src\\main.cpp' })],
      [final(requestId, 'completed', ['call_allowed'])]
    ], { allowedPaths: ['src/main.cpp'] })
    const allowedInitial = await allowed.runtime.start({ requestId, source: 'main', mode: 'auto', message: 'read', projectId })

    const completed = await approveRemote(allowed.runtime, allowedInitial)

    expect(completed.status).toBe('completed')
    expect(allowed.calls).toHaveLength(1)

    const denied = createHarness([
      [functionCall('call_denied', 'workspace_read_file', { projectId, relativePath: 'src/other.cpp' })]
    ], { allowedPaths: ['src/main.cpp'] })
    const deniedInitial = await denied.runtime.start({ requestId: crypto.randomUUID(), source: 'main', mode: 'auto', message: 'read', projectId })

    const failed = await approveRemote(denied.runtime, deniedInitial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'TOOL_POLICY_VIOLATION' })
    expect(denied.calls).toHaveLength(0)
  })

  it('allows an approved create-file call to introduce a new project-relative path', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_create', 'workspace_create_file', {
        projectId, relativePath: 'src/helper.hpp', content: '#pragma once\n'
      })],
      [final(requestId, 'completed', ['call_create'])]
    ], {
      risk: 'L2', toolName: 'workspace_create_file', allowedPaths: ['main.cpp'],
      toolResult: success(['src/helper.hpp'])
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '创建头文件', projectId })
    const approval = await approveRemote(runtime, initial)

    expect(approval.status).toBe('waiting-approval')
    const completed = await runtime.decide({ approvalId: approval.pendingApproval!.id, decision: 'approved' })

    expect(completed.status).toBe('completed')
    expect(calls).toEqual([{
      name: 'workspace.create.file',
      args: { projectId, relativePath: 'src/helper.hpp', content: '#pragma once\n' }
    }])
  })

  it('marks a large read as truncated and refuses a whole-file write based on it', async () => {
    const requestId = crypto.randomUUID()
    const largeContent = `int main() {}\n${'x'.repeat(100_001)}`
    const readResult: ToolResult = {
      ...success(),
      structuredContent: {
        projectId,
        relativePath: 'main.cpp',
        content: largeContent,
        contentHash: 'large-hash',
        modifiedAt: new Date().toISOString(),
        encoding: 'utf8',
        eol: 'lf',
        readOnly: false
      }
    }
    const { runtime, calls, requests } = createHarness([
      [functionCall('call_large_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [functionCall('call_unsafe_write', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'large-hash', content: 'int main() {}\n'
      })]
    ], {
      registeredToolNames: ['workspace_read_file', 'workspace_apply_patch'],
      toolResults: [readResult, success(['main.cpp'])]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改大文件', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(calls).toHaveLength(1)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'TOOL_POLICY_VIOLATION' })
    const observation = requests[1]?.find(item => item.type === 'function_call_output')
    expect(JSON.parse(String(observation?.output))).toMatchObject({
      callId: 'call_large_read', outputTruncated: true
    })
  })

  it('uses a complete current-run related-file read as the approval diff base', async () => {
    const requestId = crypto.randomUUID()
    const readResult: ToolResult = {
      ...success(),
      structuredContent: {
        projectId,
        relativePath: 'src/other.cpp',
        content: 'int old_value = 1;\n',
        contentHash: 'other-hash',
        modifiedAt: new Date().toISOString(),
        encoding: 'utf8',
        eol: 'lf',
        readOnly: false
      }
    }
    const { runtime } = createHarness([
      [functionCall('call_other_read', 'workspace_read_file', { projectId, relativePath: 'src/other.cpp' })],
      [functionCall('call_other_write', 'workspace_apply_patch', {
        projectId,
        relativePath: 'src/other.cpp',
        expectedHash: 'other-hash',
        content: 'int next_value = 2;\n'
      })]
    ], {
      registeredToolNames: ['workspace_read_file', 'workspace_apply_patch'],
      risks: { workspace_read_file: 'L0', workspace_apply_patch: 'L2' },
      allowedPaths: ['main.cpp', 'src/other.cpp'],
      toolResults: [readResult]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改相关文件', projectId })

    const approval = await approveRemote(runtime, initial)

    expect(approval.status).toBe('waiting-approval')
    expect(approval.pendingApproval?.diff).toContain('-int old_value = 1;')
    expect(approval.pendingApproval?.diff).toContain('+int next_value = 2;')
  })

  it('refuses a whole-file write when privacy redaction changed the read base', async () => {
    const requestId = crypto.randomUUID()
    const readResult: ToolResult = {
      ...success(),
      structuredContent: {
        projectId,
        relativePath: 'main.cpp',
        content: 'const char* local = "/home/alice/private.txt";\n',
        contentHash: 'sensitive-hash',
        modifiedAt: new Date().toISOString(),
        encoding: 'utf8',
        eol: 'lf',
        readOnly: false
      }
    }
    const { runtime, calls } = createHarness([
      [functionCall('call_sensitive_read', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [functionCall('call_redacted_write', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'sensitive-hash', content: 'const char* local = "changed";\n'
      })]
    ], {
      registeredToolNames: ['workspace_read_file', 'workspace_apply_patch'],
      toolResults: [readResult, success(['main.cpp'])]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改敏感路径', projectId })

    const failed = await approveRemote(runtime, initial)

    expect(calls).toHaveLength(1)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'TOOL_POLICY_VIOLATION' })
  })

  it('linearizes concurrent decisions for the same pending tool approval', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([
      [functionCall('call_once', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })],
      [final(requestId, 'completed', ['call_once'])]
    ], { risk: 'L2', toolName: 'workspace_apply_patch', toolResult: success(['main.cpp']), responseDelayMs: 20 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改一次', projectId })
    const waiting = await approveRemote(runtime, initial)

    const results = await Promise.allSettled([
      runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' }),
      runtime.decide({ approvalId: waiting.pendingApproval!.id, decision: 'approved' })
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('linearizes concurrent clarification continuations', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([
      [final(requestId, 'needs_input')],
      [final(requestId, 'completed')]
    ], { responseDelayMs: 20 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '需要澄清', projectId })
    const waiting = await approveRemote(runtime, initial)

    const results = await Promise.allSettled([
      runtime.continue({ runId: waiting.id, message: 'main.cpp' }),
      runtime.continue({ runId: waiting.id, message: 'other.cpp' })
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(requests).toHaveLength(2)
  })

  it('keeps a cancelled run terminal when a model request ignores cancellation and resolves late', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests, store } = createHarness([[final(requestId, 'completed')]], { responseDelayMs: 80 })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '稍后回答' })
    const decision = runtime.decide({ approvalId: initial.pendingApproval!.id, decision: 'approved' })
    while (requests.length === 0) await new Promise(resolve => setTimeout(resolve, 1))

    const cancelled = await runtime.cancel(initial.id)
    await decision
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(cancelled.status).toBe('cancelled')
    expect(store.get(initial.id)).toMatchObject({ status: 'cancelled' })
    expect(store.getSession(initial.id)).toBeUndefined()
  })

  it('grants a newly created project and its main file to later current-run tools', async () => {
    const requestId = crypto.randomUUID()
    const createdProjectId = crypto.randomUUID()
    const projectResult: ToolResult = {
      ...success(),
      exitCode: null,
      structuredContent: { projectId: createdProjectId, relativePath: 'main.cpp' }
    }
    const buildResult: ToolResult = {
      ...success(),
      structuredContent: { buildId: 'build-created-project', projectId: createdProjectId, relativePath: 'main.cpp', success: true }
    }
    const claims = [
      { type: 'project_created', callId: 'call_project', target: createdProjectId },
      { type: 'build_succeeded', callId: 'call_project_build', target: 'main.cpp' }
    ]
    const { runtime, calls } = createHarness([
      [functionCall('call_project', 'project_create', { workspaceId, mode: 'description', name: 'demo', description: 'hello' })],
      [functionCall('call_project_build', 'compiler_build', {
        projectId: createdProjectId, relativePath: 'main.cpp', standard: 'c++17'
      })],
      [final(requestId, 'completed', ['call_project', 'call_project_build'], { primary: 'create_project', claims })]
    ], {
      registeredToolNames: ['project_create', 'compiler_build'],
      toolResults: [projectResult, buildResult]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '创建并编译项目', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    expect(calls).toHaveLength(2)
  })

  it('grants a newly created path to later current-run read and build tools', async () => {
    const requestId = crypto.randomUUID()
    const created = success(['src/helper.cpp'])
    const read = {
      ...success(),
      structuredContent: {
        projectId, relativePath: 'src/helper.cpp', content: 'int helper() { return 1; }\n', contentHash: 'helper-hash'
      }
    }
    const build = {
      ...success(),
      structuredContent: { buildId: 'build-helper', projectId, relativePath: 'src/helper.cpp', success: true }
    }
    const claims = [
      { type: 'file_changed', callId: 'call_create_path', target: 'src/helper.cpp' },
      { type: 'build_succeeded', callId: 'call_build_path', target: 'src/helper.cpp' }
    ]
    const { runtime, calls } = createHarness([
      [functionCall('call_create_path', 'workspace_create_file', {
        projectId, relativePath: 'src/helper.cpp', content: 'int helper() { return 1; }\n'
      })],
      [functionCall('call_read_path', 'workspace_read_file', { projectId, relativePath: 'src/helper.cpp' })],
      [functionCall('call_build_path', 'compiler_build', {
        projectId, relativePath: 'src/helper.cpp', standard: 'c++17'
      })],
      [final(requestId, 'completed', ['call_create_path', 'call_build_path'], { primary: 'edit_code', claims })]
    ], {
      registeredToolNames: ['workspace_create_file', 'workspace_read_file', 'compiler_build'],
      toolResults: [created, read, build]
    })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '创建并编译新文件', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    expect(calls).toHaveLength(3)
  })

  it('rejects an opaque build capability that was not produced by the current run', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, calls } = createHarness([[
      functionCall('call_foreign_build', 'program_run', {
        buildId: 'build-from-another-run', input: '', timeoutMs: 1_000
      })
    ]], { toolName: 'program_run' })
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '运行程序' })

    const failed = await approveRemote(runtime, initial)

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'TOOL_POLICY_VIOLATION' })
    expect(calls).toHaveLength(0)
  })

  it('invalidates a restored session when the model endpoint contract changed under the same profile id', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const first = createHarness([[final(requestId, 'needs_input')]], { store })
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: '需要信息', projectId })
    const waiting = await approveRemote(first.runtime, initial)

    const resumed = createHarness([[final(requestId, 'completed')]], {
      store,
      profile: { ...profile, baseUrl: 'https://different.example/v1' }
    })
    expect(await resumed.runtime.restore()).toEqual([waiting.id])
    const failed = await resumed.runtime.continue({ runId: waiting.id, message: 'main.cpp' })

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROFILE_CHANGED' })
    expect(resumed.requests).toHaveLength(0)
  })

  it('does not execute a restored approved tool after the model contract changed', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const first = createHarness([[
      functionCall('call_old_contract', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'changed'
      })
    ]], { store, risk: 'L2', toolName: 'workspace_apply_patch' })
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: 'edit', projectId })
    const waiting = await approveRemote(first.runtime, initial)

    const resumed = createHarness([], {
      store,
      risk: 'L2',
      toolName: 'workspace_apply_patch',
      profile: { ...profile, baseUrl: 'https://different.example/v1' }
    })
    expect(await resumed.runtime.restore()).toEqual([waiting.id])
    const failed = await resumed.runtime.decide({
      approvalId: waiting.pendingApproval!.id,
      decision: 'approved'
    })

    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROFILE_CHANGED' })
    expect(resumed.calls).toHaveLength(0)
  })

  it('rejects a restored pending call whose persisted arguments no longer match the signed model item', async () => {
    const requestId = crypto.randomUUID()
    const store = new InMemoryRuntimeStore()
    const first = createHarness([[
      functionCall('call_tamper', 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: 'hash', content: 'approved content'
      })
    ]], { store, risk: 'L2', toolName: 'workspace_apply_patch' })
    const initial = await first.runtime.start({ requestId, source: 'main', mode: 'auto', message: '修改文件', projectId })
    const waiting = await approveRemote(first.runtime, initial)
    const session = store.getSession(waiting.id)!
    const state = session.state as { pendingCall: { arguments: Record<string, unknown> } }
    state.pendingCall.arguments.content = 'tampered content'
    store.saveSession({ ...session, state })

    const resumed = createHarness([], { store, risk: 'L2', toolName: 'workspace_apply_patch' })

    expect(await resumed.runtime.restore()).toEqual([])
    expect(store.getSession(waiting.id)).toBeUndefined()
    await expect(resumed.runtime.decide({
      approvalId: waiting.pendingApproval!.id, decision: 'approved'
    })).rejects.toThrow(/not pending/i)
    expect(resumed.calls).toHaveLength(0)
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

  it('allows one repair turn for invalid structured evidence claims', async () => {
    const requestId = crypto.randomUUID()
    const { runtime, requests } = createHarness([
      [functionCall('call_read_for_repair', 'workspace_read_file', { projectId, relativePath: 'main.cpp' })],
      [final(requestId, 'completed', ['call_read_for_repair'], {
        primary: 'edit_code',
        claims: [{ type: 'file_changed', callId: 'call_read_for_repair', target: 'main.cpp' }]
      })],
      [final(requestId, 'completed', ['call_read_for_repair'])]
    ])
    const initial = await runtime.start({ requestId, source: 'main', mode: 'auto', message: '读取并回答', projectId })

    const completed = await approveRemote(runtime, initial)

    expect(completed.status).toBe('completed')
    expect(requests).toHaveLength(3)
    expect(requests[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: [expect.objectContaining({ type: 'input_text', text: expect.stringContaining('file_changed') })]
      })
    ]))
  })
})
