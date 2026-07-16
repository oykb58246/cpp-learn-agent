import { describe, expect, it } from 'vitest'
import {
  agentRunSchema,
  approvalDecisionSchema,
  approvalSchema,
  contextPacketSchema,
  timelineEventSchema,
  toolResultSchema
} from './agent'
import { ipc } from './ipc'

const now = new Date().toISOString()

describe('H3 agent contracts', () => {
  it('exposes only fixed H3 IPC channels', () => {
    expect(ipc.agentStart).toBe('agent:start')
    expect(ipc.agentChanged).toBe('agent:changed')
    expect(ipc.approvalDecide).toBe('approval:decide')
    expect(ipc.learningSummary).toBe('learning:summary')
    expect(Object.values(ipc)).not.toContain('mcp:call-tool')
  })

  it('validates an auditable queued run and rejects unknown states', () => {
    const run = agentRunSchema.parse({
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      source: 'editor',
      mode: 'diagnose',
      message: '解释这个编译错误',
      status: 'queued',
      steps: [],
      createdAt: now,
      updatedAt: now
    })

    expect(run.status).toBe('queued')
    expect(agentRunSchema.safeParse({ ...run, status: 'unknown' }).success).toBe(false)
  })

  it('requires approval decisions to reference an existing approval', () => {
    const approval = approvalSchema.parse({
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      stepId: 'step-1',
      toolName: 'workspace.apply_patch',
      risk: 'L2',
      title: '修改 main.cpp',
      description: '应用已预览的局部修改',
      parameterSummary: { projectId: 'project', relativePath: 'main.cpp' },
      sideEffects: ['write-file'],
      status: 'pending',
      createdAt: now
    })

    expect(approval.status).toBe('pending')
    expect(approvalDecisionSchema.safeParse({ approvalId: approval.id, decision: 'approved' }).success).toBe(true)
    expect(approvalDecisionSchema.safeParse({ decision: 'approved' }).success).toBe(false)
  })

  it('bounds context and tool output entering the runtime', () => {
    expect(contextPacketSchema.safeParse({
      requestId: crypto.randomUUID(),
      sources: [{ kind: 'selection', label: 'main.cpp:1-3', content: 'int main() {}', trusted: true }],
      conceptIds: ['functions'],
      tokenEstimate: 12
    }).success).toBe(true)
    expect(toolResultSchema.safeParse({
      ok: true,
      exitCode: 0,
      summary: '编译成功',
      diagnostics: [],
      artifacts: [],
      sideEffects: [],
      retryable: false,
      durationMs: 20
    }).success).toBe(true)
    expect(toolResultSchema.safeParse({
      ok: true,
      exitCode: 0,
      summary: 'x'.repeat(20_001),
      diagnostics: [],
      artifacts: [],
      sideEffects: [],
      retryable: false,
      durationMs: 20
    }).success).toBe(false)
  })

  it('records timeline events with structured evidence', () => {
    const event = timelineEventSchema.parse({
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      sequence: 1,
      kind: 'validation',
      status: 'completed',
      title: '重新编译验证',
      summary: '构建退出码为 0',
      occurredAt: now,
      data: { exitCode: 0 }
    })
    expect(event.kind).toBe('validation')
  })
})
