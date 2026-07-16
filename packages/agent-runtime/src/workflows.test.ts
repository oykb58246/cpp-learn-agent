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
  let buildCount = 0
  const toolClient: RuntimeToolClient = {
    async call(name, args) {
      calls.push({ name, args })
      if (name === 'toolchain.detect_compilers') return result('发现 GCC', { candidates: [{ id: 'gcc:14' }] })
      if (name === 'toolchain.probe_compiler') return result('验证通过', { candidateId: args.candidateId, success: true })
      if (name === 'project.create') return result('项目已创建', { projectId, relativePath: 'main.cpp' })
      if (name === 'workspace.read_file') return result('读取成功', { content: source, hash: 'hash-1' })
      if (name === 'compiler.build') {
        buildCount += 1
        if (request.mode === 'diagnose' && buildCount === 1) return result('缺少分号', { diagnostics: [{ message: 'expected ;' }] }, false)
        return result('编译通过', { buildId: `build-${buildCount}` })
      }
      if (name === 'tests.generate_cases') return result('生成用例', { cases: [{ input: '3', expectedOutput: '0 1 2' }] })
      if (name === 'tests.run_cases') return result(calls.filter(call => call.name === name).length === 1 ? '发现边界反例' : '回归通过', { passed: calls.filter(call => call.name === name).length > 1 })
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
          sources: [{ kind: input.source === 'screenshot' ? 'screenshot' : 'file', label: input.activeFile ?? 'context', content: source, trusted: true }],
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
  return { run, calls, detail: store.get(run.id)! }
}

describe('seven H3 workflows', () => {
  it('binds a detected environment candidate after approval', async () => {
    const { run, calls } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'environment', message: '初始化环境' })
    expect(run.status).toBe('completed')
    expect(calls.map(call => call.name)).toEqual(['toolchain.detect_compilers', 'toolchain.probe_compiler', 'toolchain.bind_compiler'])
    expect(calls[1]?.args.candidateId).toBe('gcc:14')
  })

  it('creates and validates a described project', async () => {
    const { calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'project', message: '创建成绩管理程序' })
    expect(calls.map(call => call.name)).toEqual(['problem.parse', 'project.create', 'compiler.build'])
    expect(detail.approvals.some(item => item.toolName === 'project.create' && item.status === 'approved')).toBe(true)
  })

  it('explains a selection using minimal file context', async () => {
    const { calls, detail } = await execute({
      requestId: crypto.randomUUID(), source: 'editor', mode: 'explain', message: '解释选区', projectId, activeFile: 'main.cpp',
      selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, content: 'return 0;' }
    })
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file'])
    expect(detail.timeline.find(item => item.kind === 'context')?.data).toMatchObject({ sources: [{ kind: 'file', label: 'main.cpp' }] })
  })

  it('uses a failed build as evidence, approves a patch and rebuilds', async () => {
    const { run, calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '修复缺少分号', projectId, activeFile: 'main.cpp' })
    expect(run.status).toBe('completed')
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'compiler.build', 'workspace.apply_patch', 'compiler.build'])
    expect(detail.timeline.some(item => item.kind === 'validation' && item.summary === '编译通过')).toBe(true)
  })

  it('finds a logic counterexample, approves a local fix and reruns cases', async () => {
    const source = 'for (int i = 0; i <= n; ++i) { cout << i; }'
    const { calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'editor', mode: 'solve', message: '检查循环边界逻辑', projectId, activeFile: 'main.cpp' }, source)
    expect(calls.map(call => call.name)).toEqual(['workspace.read_file', 'compiler.build', 'tests.generate_cases', 'tests.run_cases', 'workspace.apply_patch', 'tests.run_cases'])
    expect(detail.timeline.some(item => item.kind === 'validation' && item.summary === '回归通过')).toBe(true)
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

  it('loads review state and updates verified learning after approval', async () => {
    const { calls, detail } = await execute({ requestId: crypto.randomUUID(), source: 'main', mode: 'review', message: '复习循环错误' })
    expect(calls.map(call => call.name)).toEqual(['learning.get_state', 'learning.update_state'])
    expect(detail.timeline.some(item => item.kind === 'learning')).toBe(true)
  })
})
