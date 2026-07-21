import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentRun, ConversationChangedEvent } from '@cpp-pet/contracts'
import { AppDatabase } from '@cpp-pet/database'
import { ConversationService } from './conversation-service'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-conversation-service-')); dirs.push(dir)
  const db = new AppDatabase(join(dir, 'app.sqlite'))
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  db.upsertWorkspace({ id: workspaceId, name: 'Lab', rootPath: dir, trustState: 'trusted', createdAt: now, lastOpenedAt: now })
  db.saveProject({ id: projectId, workspaceId, name: 'Demo', type: 'single-file', creationMode: 'manual', relativeRoot: 'demo', createdAt: now, updatedAt: now, lastOpenedAt: now })
  return { db, projectId, service: new ConversationService({ db }) }
}

describe('ConversationService', () => {
  it('creates a default conversation and returns the last opened conversation first', () => {
    const { db, projectId, service } = setup()
    const initial = service.list({ projectId })[0]!
    const second = service.create({ projectId, title: '第二个对话' })
    service.messages({ projectId, conversationId: initial.id })
    expect(service.list({ projectId }).map(item => item.id)).toEqual([initial.id, second.id])
    db.close()
  })

  it('persists an Agent exchange and writes the terminal response to its assistant message', () => {
    const { db, projectId, service } = setup()
    const changes: ConversationChangedEvent[] = []
    service.onChanged(event => changes.push(event))
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '帮我写 hello world', activeFile: 'main.cpp' })
    const now = new Date().toISOString()
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: started.user.content,
      projectId, activeFile: 'main.cpp', conversationId: conversation.id, assistantMessageId: started.assistant.id,
      status: 'completed', response: '已更新并编译通过。', steps: [], createdAt: now, updatedAt: now, completedAt: now
    }

    service.handleAgentRunChanged(run)

    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id, status: 'completed', content: '已更新并编译通过。'
    })
    expect(changes.some(event => event.kind === 'message' && event.message.status === 'completed')).toBe(true)
    db.close()
  })

  it('persists model clarification as a visible completed assistant message', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '帮我改一下' })
    const now = new Date().toISOString()
    service.handleAgentRunChanged({
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: started.user.content,
      projectId, conversationId: conversation.id, assistantMessageId: started.assistant.id,
      status: 'waiting-input', steps: [], pendingClarification: { question: '目标文件是哪一个？', requestedAt: now },
      response: '需要补充信息', createdAt: now, updatedAt: now
    })
    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id, status: 'completed', content: '目标文件是哪一个？'
    })
    db.close()
  })

  it('renders model approval as a visible assistant message instead of leaving it pending', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '解释选区' })
    const now = new Date().toISOString()
    const approvalId = crypto.randomUUID()
    service.handleAgentRunChanged({
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: started.user.content,
      projectId, conversationId: conversation.id, assistantMessageId: started.assistant.id,
      status: 'waiting-model-approval',
      pendingApproval: {
        id: approvalId, runId: approvalId, stepId: 'model-context', toolName: 'model.remote-context',
        risk: 'L3', title: '发送上下文到 OpenAI', description: '发送选区上下文',
        parameterSummary: {}, sideEffects: ['remote-request'], status: 'pending', createdAt: now
      },
      steps: [], createdAt: now, updatedAt: now
    })

    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id, status: 'streaming', content: '等待确认发送模型上下文。'
    })
    db.close()
  })

  it('updates active run stages so the workspace panel does not show an empty pending answer', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '修复编译错误' })
    const now = new Date().toISOString()

    service.handleAgentRunChanged({
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: started.user.content,
      projectId, conversationId: conversation.id, assistantMessageId: started.assistant.id,
      status: 'model-requesting', steps: [], createdAt: now, updatedAt: now
    })

    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id, status: 'streaming', content: '正在请求模型。'
    })
    db.close()
  })

  it('turns model request failures into a terminal failed assistant message', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '解释这段代码' })
    const now = new Date().toISOString()

    service.handleAgentRunChanged({
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto', message: started.user.content,
      projectId, conversationId: conversation.id, assistantMessageId: started.assistant.id,
      status: 'failed', errorCode: 'MODEL_REQUEST_FAILED', errorMessage: 'OpenAI Responses request failed',
      steps: [], createdAt: now, updatedAt: now, completedAt: now
    })

    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id,
      status: 'failed',
      content: 'OpenAI 请求失败，回答未完成。',
      errorCode: 'MODEL_REQUEST_FAILED',
      errorMessage: 'OpenAI Responses request failed'
    })
    db.close()
  })
  it('creates a visible screenshot user message in the bound conversation', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    const screenshot = {
      id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' as const,
      width: 320, height: 180, createdAt: new Date().toISOString()
    }

    const started = service.beginAgentTask({
      projectId,
      conversationId: conversation.id,
      message: '解释这张截图',
      screenshot
    })

    expect(started.user).toMatchObject({
      conversationId: conversation.id,
      role: 'user',
      kind: 'screenshot-question',
      content: '解释这张截图',
      screenshot
    })
    expect(service.messages({ projectId, conversationId: conversation.id })[0]).toMatchObject({ screenshot })
    db.close()
  })
  it('rejects a conversation that belongs to another project', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    expect(() => service.messages({ projectId: crypto.randomUUID(), conversationId: conversation.id })).toThrow('not found')
    db.close()
  })
})
