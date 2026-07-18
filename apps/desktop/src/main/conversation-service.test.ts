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

  it('rejects a conversation that belongs to another project', () => {
    const { db, projectId, service } = setup()
    const conversation = service.create({ projectId })
    expect(() => service.messages({ projectId: crypto.randomUUID(), conversationId: conversation.id })).toThrow('not found')
    db.close()
  })
})
