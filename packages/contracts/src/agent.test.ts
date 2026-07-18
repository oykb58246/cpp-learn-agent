import { describe, expect, it } from 'vitest'
import {
  agentRunSchema,
  agentStartRequestSchema,
  approvalDecisionSchema,
  approvalSchema,
  contextPacketSchema,
  timelineEventSchema,
  toolCallSchema,
  toolResultSchema
} from './agent'
import { ipc } from './ipc'

const now = new Date().toISOString()

describe('H3 agent contracts', () => {
  it('exposes only fixed H3 IPC channels', () => {
    expect(ipc.agentStart).toBe('agent:start')
    expect(ipc.agentContinue).toBe('agent:continue')
    expect(ipc.agentChanged).toBe('agent:changed')
    expect(ipc.approvalDecide).toBe('approval:decide')
    expect(ipc.learningSummary).toBe('learning:summary')
    expect(ipc.learningCatalog).toBe('learning:catalog')
    expect(ipc.petChanged).toBe('pet:changed')
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

  it('accepts a run with 20 auditable steps', () => {
    const steps = Array.from({ length: 20 }, (_, sequence) => ({
      id: `step-${sequence + 1}`,
      sequence,
      title: `Step ${sequence + 1}`,
      kind: 'tool' as const,
      status: 'completed' as const,
      toolName: 'compiler.build'
    }))

    const result = agentRunSchema.safeParse({
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      source: 'editor',
      mode: 'edit',
      message: 'Complete a multi-step edit task',
      status: 'completed',
      steps,
      createdAt: now,
      updatedAt: now,
      completedAt: now
    })

    expect(result.success).toBe(true)
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
      diff: '--- a/main.cpp\n+++ b/main.cpp\n@@ -1 +1 @@\n-return 0;\n+return 1;',
      sideEffects: ['write-file'],
      status: 'pending',
      createdAt: now
    })

    expect(approval.status).toBe('pending')
    expect((approval as { diff?: string }).diff).toContain('+return 1;')
    expect(approvalSchema.safeParse({ ...approval, diff: 'x'.repeat(100_001) }).success).toBe(false)
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

  it('accepts bounded editor diagnostics as request context', () => {
    const request = agentStartRequestSchema.parse({
      source: 'editor', mode: 'diagnose', message: '解释当前错误',
      diagnostics: [{
        source: 'compiler', severity: 'error', rawMessage: 'expected ;', normalizedMessage: '缺少分号', relatedConceptIds: ['basics.statements']
      }]
    })

    expect(request.diagnostics).toHaveLength(1)
    const diagnostic = request.diagnostics?.[0]
    expect(diagnostic).toBeDefined()
    expect(agentStartRequestSchema.safeParse({ ...request, diagnostics: Array.from({ length: 201 }, () => diagnostic!) }).success).toBe(false)
  })

  it('links automatic Agent requests and runs to a conversation message', () => {
    const conversationId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const request = agentStartRequestSchema.parse({
      source: 'editor', mode: 'auto', message: '帮我写一个 hello world 程序',
      conversationId, assistantMessageId
    })
    const run = agentRunSchema.parse({
      id: crypto.randomUUID(), requestId: request.requestId, source: request.source, mode: request.mode,
      message: request.message, conversationId, assistantMessageId,
      status: 'queued', steps: [], createdAt: now, updatedAt: now
    })

    expect(request.mode).toBe('auto')
    expect(run.conversationId).toBe(conversationId)
    expect(run.assistantMessageId).toBe(assistantMessageId)
    expect(agentStartRequestSchema.safeParse({ ...request, conversationId: undefined, assistantMessageId }).success).toBe(false)
  })

  it('requires a concrete review item for review requests', () => {
    const reviewItemId = crypto.randomUUID()
    const request = agentStartRequestSchema.parse({
      source: 'main', mode: 'review', message: '复习循环边界', reviewItemId, reviewOutcome: 'passed'
    })

    expect(request.reviewItemId).toBe(reviewItemId)
    expect(request.reviewOutcome).toBe('passed')
    expect(agentStartRequestSchema.safeParse({ source: 'main', mode: 'review', message: '复习循环边界', reviewItemId }).success).toBe(false)
    expect(agentStartRequestSchema.safeParse({ source: 'main', mode: 'chat', message: '解释循环', reviewItemId }).success).toBe(false)
    expect(agentStartRequestSchema.safeParse({ source: 'main', mode: 'chat', message: '解释循环', reviewOutcome: 'failed' }).success).toBe(false)
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

  it('validates auditable tool calls with bounded parameters and results', () => {
    const call = toolCallSchema.parse({
      id: crypto.randomUUID(), runId: crypto.randomUUID(), stepId: 'build', serverName: 'cpppilot-local-tools',
      toolName: 'compiler.build', risk: 'L1', parameterSummary: { relativePath: 'main.cpp' }, status: 'completed',
      result: { ok: true, exitCode: 0, summary: '编译通过', diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 12 },
      startedAt: now, finishedAt: now, durationMs: 12
    })

    expect(call.toolName).toBe('compiler.build')
    expect(toolCallSchema.safeParse({ ...call, status: 'unknown' }).success).toBe(false)
  })
})
