import { describe, expect, it } from 'vitest'
import type { AgentStartRequest, ContextPacket, ToolResult } from '@cpp-pet/contracts'
import { AgentRuntime, InMemoryRuntimeStore, type RuntimeToolClient } from './runtime'
import { H3WorkflowPlanner } from './workflows'

const projectId = crypto.randomUUID()

function result(summary: string, structuredContent?: unknown, ok = true): ToolResult {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    summary,
    ...(structuredContent === undefined ? {} : { structuredContent }),
    diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1
  }
}

async function execute(request: AgentStartRequest, source = 'int main() {\n  return 0\n}') {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let finalSource = source
  let buildCount = 0
  const toolClient: RuntimeToolClient = {
    async call(name, args) {
      calls.push({ name, args })
      if (name === 'toolchain.detect_compilers') return result('发现 GCC', { candidates: [{ id: 'gcc:14' }] })
      if (name === 'toolchain.probe_compiler') return result('验证通过', { candidate: { id: args.candidateId }, success: true })
      if (name === 'project.create') return result('项目已创建', { projectId, relativePath: 'main.cpp' })
      if (name === 'workspace.read_file') return result('读取成功', { content: source, contentHash: 'hash-1' })
      if (name === 'workspace.apply_patch') {
        finalSource = String(args.content ?? '')
        return result('file updated', { contentHash: 'hash-2' })
      }
      if (name === 'compiler.build') {
        buildCount += 1
        if (request.mode === 'diagnose' && buildCount === 1) return result('缺少分号', { diagnostics: [{ message: 'expected ;' }] }, false)
        return result('编译通过', { buildId: `build-${buildCount}` })
      }
      if (name === 'tests.generate_cases') return result('生成用例', { cases: [{ input: '3', expectedOutput: '0 1 2' }] })
      if (name === 'tests.run_cases') {
        const firstRun = calls.filter(call => call.name === name).length === 1
        const passed = !firstRun && !request.message.includes('回归仍失败')
        return result(firstRun ? '发现边界反例' : passed ? '回归通过' : '回归仍失败', { passed }, passed)
      }
      if (name === 'learning.get_state') return result('读取复习项', {
        knowledge: [], errors: [], reviews: [{ id: request.reviewItemId, conceptId: 'control.loops' }]
      })
      return result(`${name} 完成`)
    }
  }
  const store = new InMemoryRuntimeStore()
  const runtime = new AgentRuntime({
    store,
    contextBuilder: {
      async build(input): Promise<ContextPacket> {
        return {
          requestId: input.requestId,
          sources: [
            ...(input.selection ? [{ kind: 'selection' as const, label: '选区', content: input.selection.content, trusted: true }] : []),
            ...(!(input.mode === 'explain' && input.selection) ? [{ kind: input.source === 'screenshot' ? 'screenshot' as const : 'file' as const, label: input.activeFile ?? 'context', content: source, trusted: true }] : [])
          ],
          conceptIds: [], tokenEstimate: 20, truncated: false
        }
      }
    },
    planner: new H3WorkflowPlanner(),
    toolClient,
    knowledgeGate: { check: () => ({ decision: 'allow', allowed: [], blocked: [], suggestedConceptIds: [], explanation: 'ok' }) }
  })
  let run = await runtime.start(request)
  while (run.status === 'waiting-approval') {
    run = await runtime.decide({ approvalId: run.pendingApproval!.id, decision: 'approved' })
  }
  return { run, calls, detail: store.get(run.id)!, finalSource }
}

describe('seven H3 workflows', () => {
  it('binds a detected environment candidate after approval', async () => {
    const { run, calls } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'environment', message: '初始化环境' })
    expect(run.status).toBe('completed')
    expect(run.response).toContain('工具链')
    expect(calls.map(call => call.name)).toEqual(['toolchain.detect_compilers', 'toolchain.probe_compiler', 'toolchain.bind_compiler'])
    expect(calls[1]?.args.candidateId).toBe('gcc:14')
  })

  it('creates and validates a described project', async () => {
    const { run, calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'project', message: '创建成绩管理程序' })
    expect(calls.map(call => call.name)).toEqual(['problem.parse', 'project.create', 'compiler.build'])
    expect(run.response).toContain('编译')
    expect(detail.approvals.some(item => item.toolName === 'project.create' && item.status === 'approved')).toBe(true)
  })

  it('explains a selection using minimal file context', async () => {
    const { run, calls, detail } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释选区', projectId, activeFile: 'main.cpp',
      selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, content: 'return 0;' }
    })
    expect(calls).toEqual([])
    expect(run.response).toContain('return')
    expect(detail.timeline.find(item => item.kind === 'context')?.data).toMatchObject({ sources: [{ kind: 'selection', label: '选区' }] })
  })

  it('uses a failed build as evidence, approves a patch and rebuilds', async () => {
    const { run, calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '修复缺少分号', projectId, activeFile: 'main.cpp' })
    expect(run.status).toBe('completed')
    expect(run.response).toContain('重新编译')
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'compiler.build', 'workspace.apply_patch', 'compiler.build', 'learning.record_error'])
    expect(detail.timeline.some(item => item.kind === 'validation' && item.summary === '编译通过')).toBe(true)
  })

  it('uses the complete file rather than the selection as patch content', async () => {
    const source = '#include <iostream>\nint main() {\n  std::cout << "x"\n  return 0;\n}\n'
    const { calls } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '修复选中错误', projectId, activeFile: 'main.cpp',
      selection: { startLine: 3, startColumn: 3, endLine: 3, endColumn: 19, content: 'std::cout << "x"' }
    }, source)
    const patch = calls.find(call => call.name === 'workspace.apply_patch')

    expect(patch?.args.content).toContain('#include <iostream>')
    expect(patch?.args.content).toContain('std::cout << "x";')
  })

  it('finds a logic counterexample, approves a local fix and reruns cases', async () => {
    const source = 'for (int i = 0; i <= n; ++i) { cout << i; }'
    const { run, calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'editor', mode: 'solve', message: '检查循环边界逻辑', projectId, activeFile: 'main.cpp' }, source)
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'compiler.build', 'tests.generate_cases', 'tests.run_cases', 'workspace.apply_patch', 'tests.run_cases', 'learning.record_error'])
    expect(run.response).toContain('回归')
    expect(detail.timeline.some(item => item.kind === 'validation' && item.summary === '回归通过')).toBe(true)
  })

  it('does not record a resolved logic error when regression cases still fail', async () => {
    const source = 'for (int i = 0; i <= n; ++i) { cout << i; }'
    const { run, calls } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'solve', message: '检查循环边界，回归仍失败', projectId, activeFile: 'main.cpp'
    }, source)

    expect(run.status).toBe('failed')
    expect(calls.filter(call => call.name === 'tests.run_cases')).toHaveLength(2)
    expect(calls.some(call => call.name === 'learning.record_error')).toBe(false)
  })

  it('requires L3 approval before accepting screenshot context', async () => {
    const screenshot = {
      id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' as const,
      width: 10, height: 10, createdAt: new Date().toISOString()
    }
    const { calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'screenshot', mode: 'explain', message: '解释截图', screenshot })
    expect(calls).toEqual([])
    expect(detail.approvals.some(item => item.risk === 'L3' && item.status === 'approved')).toBe(true)
  })

  it('turns a legacy review request into an explanatory follow-up without learning writes', async () => {
    const reviewItemId = crypto.randomUUID()
    const { calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'review', message: '复习循环错误', reviewItemId, reviewOutcome: 'passed' })
    expect(calls).toEqual([])
    expect(detail.response).toContain('不会记录成绩')
    expect(detail.timeline.some(item => item.kind === 'learning')).toBe(false)
  })

  it('keeps a legacy failed review request as an explanatory follow-up', async () => {
    const reviewItemId = crypto.randomUUID()
    const { run, calls } = await execute({
      requestId: crypto.randomUUID(), source: 'main', mode: 'review', message: '循环边界仍不熟悉', reviewItemId, reviewOutcome: 'failed'
    })

    expect(run.status).toBe('completed')
    expect(calls).toEqual([])
    expect(run.response).toContain('下一步')
  })

  it('edits the requested file and only completes after a successful rebuild', async () => {
    const source = '#include <iostream>\nusing namespace std;\nint Main() {\n  cout << "Hello, C++Pilot!" << endl;\n  return 0;\n}\n'
    const { run, calls, detail, finalSource } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'edit',
      message: '帮我把 main.cpp 中的"Hello, C++Pilot!"改成"Hello, world!"，编译成功后再解释 main、cout 和 endl 的作用',
      projectId, activeFile: 'main.cpp'
    }, source)

    expect(run.status).toBe('completed')
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'workspace.apply_patch', 'compiler.build'])
    expect(calls.find(call => call.name === 'workspace.apply_patch')?.args.content).toContain('"Hello, world!"')
    expect(calls.find(call => call.name === 'workspace.apply_patch')?.args.content).toContain('int main()')
    expect(finalSource).toContain('"Hello, world!"')
    expect(finalSource).toContain('int main()')
    expect(detail.timeline.some(item => item.kind === 'validation' && item.data?.toolName === 'compiler.build')).toBe(true)
    expect(run.response).toContain('cout')
  })

  it.each([
    {
      name: 'backtick-delimited code',
      source: 'int main() {\n  int value = 1;\n  return value;\n}\n',
      message: '把 `int value = 1;` 改成 `int value = 2;`，然后编译',
      expected: 'int value = 2;'
    },
    {
      name: 'multiple quoted replacements',
      source: 'int main() {\n  const char* a = "alpha";\n  const char* b = "left";\n}\n',
      message: '把"alpha"改成"beta"，再把"left"改成"right"，编译验证',
      expected: 'const char* b = "right";'
    },
    {
      name: 'a single target value for the only string literal',
      source: '#include <iostream>\nint main() { std::cout << "Hello"; }\n',
      message: '把 main.cpp 的输出文字改成"Goodbye!"并编译',
      expected: 'std::cout << "Goodbye!"'
    }
  ])('supports $name', async ({ source, message, expected }) => {
    const { run, calls, finalSource } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'edit', message,
      projectId, activeFile: 'main.cpp'
    }, source)

    expect(run.status).toBe('completed')
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'workspace.apply_patch', 'compiler.build'])
    expect(finalSource).toContain(expected)
  })

  it('does not claim a file edit when the offline request has no actionable replacement', async () => {
    const { run, calls, finalSource } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'edit',
      message: '调整输出并编译', projectId, activeFile: 'main.cpp'
    }, 'int main() { return 0; }\n')

    expect(run.status).toBe('completed')
    expect(calls).toEqual([])
    expect(finalSource).toBe('int main() { return 0; }\n')
    expect(run.response).toContain('无法确定')
  })
})
