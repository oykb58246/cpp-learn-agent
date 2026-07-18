import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentRun, ConversationChangedEvent, ConversationMessageDelta, ModelProfile } from '@cpp-pet/contracts'
import { AppDatabase } from '@cpp-pet/database'
import { builtInKnowledge } from '@cpp-pet/agent-runtime'
import { ConversationService, type ConversationStreamingGateway } from './conversation-service'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup(gateway: ConversationStreamingGateway, withModel = true) {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-conversation-service-')); dirs.push(dir)
  const db = new AppDatabase(join(dir, 'app.sqlite'))
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  db.upsertWorkspace({ id: workspaceId, name: 'Lab', rootPath: dir, trustState: 'trusted', createdAt: now, lastOpenedAt: now })
  db.saveProject({ id: projectId, workspaceId, name: 'Demo', type: 'single-file', creationMode: 'manual', relativeRoot: 'demo', createdAt: now, updatedAt: now, lastOpenedAt: now })
  if (withModel) {
    const model: ModelProfile = {
      id: crypto.randomUUID(), name: 'Test', baseUrl: 'https://model.example/v1', model: 'teacher', enabled: true,
      timeoutMs: 5_000, apiKeyConfigured: true, createdAt: now, updatedAt: now
    }
    db.saveModelProfile(model)
  }
  const service = new ConversationService({
    db,
    workspace: { readFile: (_projectId, relativePath) => ({ relativePath, content: 'int main() { return 0; }' }) },
    secrets: { get: () => 'secret' },
    gateway,
    nodes: builtInKnowledge,
    flushIntervalMs: 1
  })
  return { db, projectId, service }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition not reached')
}

describe('ConversationService', () => {
  it('creates a default conversation and returns the last opened conversation first', () => {
    const { db, projectId, service } = setup({ async stream() {} })

    const initial = service.list({ projectId })[0]!
    const second = service.create({ projectId, title: '第二个对话' })
    service.messages({ projectId, conversationId: initial.id })

    expect(service.list({ projectId }).map(item => item.id)).toEqual([initial.id, second.id])
    db.close()
  })

  it('creates a project conversation and persists ordered streamed deltas', async () => {
    const gateway: ConversationStreamingGateway = {
      async stream(_input, _signal, onDelta) { await onDelta('你好'); await onDelta('，这是解释。') }
    }
    const { db, projectId, service } = setup(gateway)
    const deltas: ConversationMessageDelta[] = []
    const changes: ConversationChangedEvent[] = []
    service.onDelta(event => deltas.push(event))
    service.onChanged(event => changes.push(event))
    const conversation = service.create({ projectId })
    const started = service.send({ projectId, conversationId: conversation.id, message: '解释 main', activeFile: 'main.cpp' })
    expect(started.user.status).toBe('completed')
    expect(started.assistant.status).toBe('pending')
    await waitFor(() => changes.some(event => event.kind === 'message' && event.message.id === started.assistant.id && event.message.status === 'completed'))
    expect(deltas.map(item => [item.sequence, item.delta])).toEqual([[0, '你好'], [1, '，这是解释。']])
    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({ content: '你好，这是解释。', status: 'completed' })
    expect(service.list({ projectId })[0]).toMatchObject({ id: conversation.id, title: '解释 main' })
    db.close()
  })

  it('persists a visible failed assistant message when no model is configured', async () => {
    const { db, projectId, service } = setup({ async stream() { throw new Error('should not run') } }, false)
    const changes: ConversationChangedEvent[] = []
    service.onChanged(event => changes.push(event))
    const conversation = service.create({ projectId })
    const started = service.send({ projectId, conversationId: conversation.id, message: '你好' })
    await waitFor(() => changes.some(event => event.kind === 'message' && event.message.id === started.assistant.id && event.message.status === 'failed'))
    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({ status: 'failed', errorCode: 'MODEL_NOT_CONFIGURED' })
    db.close()
  })

  it('persists an Agent task exchange and writes the terminal run response back to the assistant message', () => {
    const { db, projectId, service } = setup({ async stream() {} })
    const changes: ConversationChangedEvent[] = []
    service.onChanged(event => changes.push(event))
    const conversation = service.create({ projectId })
    const started = service.beginAgentTask({ projectId, conversationId: conversation.id, message: '帮我写一个 hello world 程序', activeFile: 'main.cpp' })
    const baseRun: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'editor', mode: 'auto',
      message: started.user.content, projectId, activeFile: 'main.cpp', conversationId: conversation.id,
      assistantMessageId: started.assistant.id, status: 'waiting-approval', steps: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }

    service.handleAgentRunChanged(baseRun)
    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({ id: started.assistant.id, status: 'pending' })

    service.handleAgentRunChanged({ ...baseRun, status: 'completed', response: '已更新 `main.cpp`，并且编译通过。', completedAt: new Date().toISOString() })
    expect(service.messages({ projectId, conversationId: conversation.id }).at(-1)).toMatchObject({
      id: started.assistant.id, status: 'completed', content: '已更新 `main.cpp`，并且编译通过。'
    })
    expect(changes.some(event => event.kind === 'message' && event.message.id === started.assistant.id && event.message.status === 'completed')).toBe(true)
    db.close()
  })

  it('stops an active stream and keeps partial content', async () => {
    let attempt = 0
    const gateway: ConversationStreamingGateway = {
      async stream(_input, signal, onDelta) {
        attempt += 1
        if (attempt > 1) { await onDelta('重试成功'); return }
        await onDelta('部分回答')
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      }
    }
    const { db, projectId, service } = setup(gateway)
    const conversation = service.create({ projectId })
    const started = service.send({ projectId, conversationId: conversation.id, message: '长回答' })
    await waitFor(() => service.messages({ projectId, conversationId: conversation.id }).at(-1)?.content === '部分回答')
    const stopped = service.stop({ projectId, conversationId: conversation.id })
    expect(stopped).toMatchObject({ id: started.assistant.id, content: '部分回答', status: 'stopped' })
    const retried = service.retry({ projectId, conversationId: conversation.id, messageId: started.assistant.id })
    await waitFor(() => service.messages({ projectId, conversationId: conversation.id }).some(item => item.id === retried.assistant.id && item.status === 'completed'))
    db.close()
  })

  it('rejects a conversation that belongs to another project', () => {
    const { db, projectId, service } = setup({ async stream() {} })
    const conversation = service.create({ projectId })
    expect(() => service.messages({ projectId: crypto.randomUUID(), conversationId: conversation.id })).toThrow('not found')
    db.close()
  })
})
