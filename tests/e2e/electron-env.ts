import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export function createElectronEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides }
  delete environment.ELECTRON_RUN_AS_NODE
  return environment
}

type ResponseInputItem = Record<string, any>
type ResponsesRequest = { input?: ResponseInputItem[]; [key: string]: unknown }

export interface StreamingModelFixture {
  baseUrl: string
  requests: ResponsesRequest[]
  close(): Promise<void>
}

export async function startStreamingModelFixture(): Promise<StreamingModelFixture> {
  let slowStopResponseServed = false
  const requests: ResponsesRequest[] = []
  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResponsesRequest
    requests.push(structuredClone(payload))
    const input = payload.input ?? []
    const context = findContext(input)
    const prompt = context?.task?.prompt ?? ''
    const taskId = context?.taskId ?? crypto.randomUUID()
    const observations = input
      .filter(item => item.type === 'function_call_output')
      .map(item => JSON.parse(String(item.output)) as Record<string, any>)

    if (prompt.includes('停止测试') && !slowStopResponseServed) {
      slowStopResponseServed = true
      await new Promise(resolve => setTimeout(resolve, 4_000))
    }

    const output = nextOutput({ input, prompt, taskId, context, observations })
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({
      id: `resp_${requests.length}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1_000),
      status: 'completed',
      error: null,
      incomplete_details: null,
      output
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

function findContext(input: ResponseInputItem[]): Record<string, any> | undefined {
  for (const item of input) {
    if (item.role !== 'user' || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (content.type !== 'input_text' || typeof content.text !== 'string') continue
      try {
        const parsed = JSON.parse(content.text)
        if (parsed?.protocol === 'cpppilot.context.v1') return parsed
      } catch { /* A clarification answer is plain input text. */ }
    }
  }
  return undefined
}

function nextOutput(options: {
  input: ResponseInputItem[]
  prompt: string
  taskId: string
  context?: Record<string, any>
  observations: Array<Record<string, any>>
}): ResponseInputItem[] {
  const { input, prompt, taskId, context, observations } = options
  const projectId = context?.workspace?.project?.id
  const activeFile = context?.workspace?.activeFile
  const tools = new Set(observations.map(item => item.tool))
  const editGreeting = prompt.includes('Hello, C++Pilot!')
  const diagnose = prompt.includes('修复当前编译错误')

  if (prompt.includes('E2E_SCENARIO:refusal')) {
    return [refusal(taskId, 'E2E refusal from the model')]
  }

  if (prompt.includes('E2E_SCENARIO:invalid-final')) {
    return [invalidFinal(taskId)]
  }

  if (prompt.includes('E2E_SCENARIO:clarification')) {
    const answered = input.some(item => item.role === 'user' && Array.isArray(item.content)
      && item.content.some(content => content.type === 'input_text' && content.text === 'main.cpp'))
    return [answered
      ? final(taskId, 'answer', [], 'Continuing the same run with `main.cpp`.')
      : final(taskId, 'answer', [], 'I need one detail before continuing.', {
          status: 'needs_input',
          clarificationQuestion: 'Which file should I update?'
        })]
  }

  if (prompt.includes('E2E_SCENARIO:approval-rejection')) {
    const rejected = observations.find(item => item.callId === `reject_${taskId}`)
    if (!rejected) {
      return [call(`reject_${taskId}`, 'workspace_apply_patch', {
        projectId,
        relativePath: 'main.cpp',
        expectedHash: activeFile?.contentHash,
        content: '#include <iostream>\nint main() {\n  std::cout << "not applied" << std::endl;\n}\n'
      })]
    }
    return [final(taskId, 'edit_code', [], 'The requested edit was not applied because approval was rejected.', {
      status: 'failed'
    })]
  }

  if (prompt.includes('E2E_SCENARIO:tool-recovery')) {
    const builds = observations.filter(item => item.tool === 'compiler.build')
    const patch = observations.find(item => item.callId === `recovery_patch_${taskId}`)
    const successfulBuild = builds.find(item => item.ok === true)
    if (builds.length === 0) {
      return [call(`recovery_build_initial_${taskId}`, 'compiler_build', {
        runId: taskId, projectId, relativePath: 'main.cpp', standard: 'c++17'
      })]
    }
    if (!patch) {
      return [call(`recovery_patch_${taskId}`, 'workspace_apply_patch', {
        projectId,
        relativePath: 'main.cpp',
        expectedHash: activeFile?.contentHash,
        content: '#include <iostream>\nint main() {\n  std::cout << "recover" << std::endl;\n  return 0;\n}\n'
      })]
    }
    if (!successfulBuild) {
      return [call(`recovery_build_final_${taskId}`, 'compiler_build', {
        runId: taskId, projectId, relativePath: 'main.cpp', standard: 'c++17'
      })]
    }
    const evidenceCallIds = [patch.callId, successfulBuild.callId]
    return [final(taskId, 'edit_code', evidenceCallIds,
      'The compiler failure was observed, the file was fixed, and the second build succeeded.', {
        claims: claimsFor(observations, evidenceCallIds)
      })]
  }

  if (editGreeting) {
    if (!tools.has('workspace.read_file')) {
      return [call(`read_${taskId}`, 'workspace_read_file', { projectId, relativePath: 'main.cpp' })]
    }
    if (!tools.has('workspace.apply_patch')) {
      return [call(`patch_${taskId}`, 'workspace_apply_patch', {
        projectId,
        relativePath: 'main.cpp',
        expectedHash: activeFile?.contentHash,
        content: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, world!" << endl;\n    return 0;\n}\n'
      })]
    }
    if (!tools.has('compiler.build')) {
      return [call(`build_${taskId}`, 'compiler_build', { runId: taskId, projectId, relativePath: 'main.cpp', standard: 'c++17' })]
    }
    const evidenceCallIds = observations.map(item => item.callId)
    return [final(taskId, 'edit_code', evidenceCallIds,
      '已将 `main.cpp` 更新为 `Hello, world!` 并完成编译验证。`main` 是程序入口，`cout` 负责标准输出，`endl` 输出换行并刷新缓冲区。', {
        claims: claimsFor(observations, evidenceCallIds)
      })]
  }

  if (diagnose) {
    if (!tools.has('workspace.apply_patch')) {
      const content = String(activeFile?.content ?? '').replace('std::cout << "missing semicolon"\n', 'std::cout << "missing semicolon";\n')
      return [call(`patch_${taskId}`, 'workspace_apply_patch', {
        projectId, relativePath: 'main.cpp', expectedHash: activeFile?.contentHash, content
      })]
    }
    if (!tools.has('compiler.build')) {
      return [call(`build_${taskId}`, 'compiler_build', { runId: taskId, projectId, relativePath: 'main.cpp', standard: 'c++17' })]
    }
    const evidenceCallIds = observations.map(item => item.callId)
    return [final(taskId, 'edit_code', evidenceCallIds, '已补充分号并通过编译。根因是输出语句末尾缺少语句终止符 `;`。', {
      claims: claimsFor(observations, evidenceCallIds)
    })]
  }

  if (prompt.includes('Markdown 渲染测试')) {
    return [final(taskId, 'answer', [], '## 修复建议\n\n**粗体结论** 和 `inline code`\n\n```cpp\nstd::cout << "ok";\n```\n\n> 引用说明\n\n- 列表项\n\n| 项目 | 状态 |\n| --- | --- |\n| Markdown | 正常 |\n\n<img src="x" onerror="document.body.dataset.markdownXss = \'yes\'">\n<script>document.body.dataset.markdownScript = \'yes\'</script>\n<a href="javascript:alert(1)">恶意链接</a>')]
  }
  if (prompt.includes('错误')) return [final(taskId, 'diagnose_error', [], '先看共同原因：字符串不能直接赋值给 int，请逐个检查两个出现位置。')]
  if (prompt.includes('循环') || prompt.includes('for (int i')) {
    return [final(taskId, 'explain_code', [], '这个循环从 0 开始，在条件为真时重复执行，并在每轮后递增计数器。')]
  }
  return [final(taskId, 'answer', [], prompt.includes('停止测试') ? '这次回答已经完成。' : '我们一步一步来看。这次回答已经完成。')]
}

function call(callId: string, name: string, args: Record<string, unknown>): ResponseInputItem {
  return {
    type: 'function_call', id: `fc_${callId}`, call_id: callId, name,
    arguments: JSON.stringify(args), status: 'completed'
  }
}

function refusal(taskId: string, message: string): ResponseInputItem {
  return {
    type: 'message', id: `msg_${taskId}_${crypto.randomUUID()}`, role: 'assistant', status: 'completed',
    content: [{ type: 'refusal', refusal: message }]
  }
}

function invalidFinal(taskId: string): ResponseInputItem {
  return {
    type: 'message', id: `msg_${taskId}_${crypto.randomUUID()}`, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', annotations: [], text: '{}' }]
  }
}

function final(
  taskId: string,
  primary: string,
  evidenceCallIds: string[],
  messageMarkdown: string,
  options: {
    status?: 'completed' | 'needs_input' | 'failed'
    clarificationQuestion?: string | null
    claims?: Array<{ type: string; callId: string; target: string | null }>
  } = {}
): ResponseInputItem {
  return {
    type: 'message', id: `msg_${taskId}_${crypto.randomUUID()}`, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', annotations: [], text: JSON.stringify({
      protocol: 'cpppilot.final.v1', taskId, status: options.status ?? 'completed',
      intent: { primary, secondary: [] }, messageMarkdown,
      clarificationQuestion: options.clarificationQuestion ?? null,
      evidenceCallIds, claims: options.claims ?? [], suggestedNextActions: []
    }) }]
  }
}

function claimsFor(
  observations: Array<Record<string, any>>,
  evidenceCallIds: string[]
): Array<{ type: string; callId: string; target: string | null }> {
  const allowed = new Set(evidenceCallIds)
  return observations
    .filter(observation => allowed.has(String(observation.callId)))
    .flatMap(observation => (Array.isArray(observation.outcomes) ? observation.outcomes : []).map((outcome: Record<string, any>) => ({
      type: String(outcome.type),
      callId: String(observation.callId),
      target: typeof outcome.target === 'string' ? outcome.target : null
    })))
}
