import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentConversation, AgentMessage, DiagnosticFailureKind, DiagnosticIncidentDetail } from '@cpp-pet/contracts'
import { AppDatabase } from './index'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-conversation-')); dirs.push(dir)
  const file = join(dir, 'app.sqlite')
  const db = new AppDatabase(file)
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  db.upsertWorkspace({ id: workspaceId, name: 'Lab', rootPath: dir, trustState: 'trusted', createdAt: now, lastOpenedAt: now })
  db.saveProject({ id: projectId, workspaceId, name: 'Demo', type: 'single-file', creationMode: 'manual', relativeRoot: 'demo', createdAt: now, updatedAt: now, lastOpenedAt: now })
  return { db, file, projectId, now }
}

function incident(projectId: string, kinds: DiagnosticFailureKind[] = ['compile']): DiagnosticIncidentDetail {
  const id = crypto.randomUUID()
  const groupId = crypto.randomUUID()
  const now = new Date().toISOString()
  return {
    id, projectId, attemptId: crypto.randomUUID(), targetKey: 'main.cpp:c++17', operation: kinds.includes('compile') ? 'build' : 'run',
    failureKinds: kinds, status: 'active', createdAt: now, updatedAt: now,
    groups: [{
      id: groupId, incidentId: id, fingerprint: `fingerprint-${kinds.join('-')}`, source: kinds.includes('compile') ? 'compiler' : 'runtime',
      failureKind: kinds[0]!, severity: 'error', title: '示例错误', normalizedTemplate: 'example error', occurrenceCount: 2, createdAt: now,
      occurrences: [
        { id: crypto.randomUUID(), groupId, file: 'main.cpp', line: 2, column: 3, rawMessage: 'example 1', normalizedMessage: 'example error' },
        { id: crypto.randomUUID(), groupId, file: 'main.cpp', line: 8, column: 3, rawMessage: 'example 2', normalizedMessage: 'example error' }
      ]
    }]
  }
}

function conversation(projectId: string): AgentConversation {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), projectId, title: '新对话', status: 'active', createdAt: now, updatedAt: now }
}

function message(conversationId: string, role: AgentMessage['role'], status: AgentMessage['status']): AgentMessage {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), conversationId, role, kind: 'text', content: role === 'user' ? '为什么报错？' : '正在解释', status, createdAt: now, updatedAt: now }
}

describe('conversation and diagnostic persistence', () => {
  it('persists incidents, groups, occurrences, conversations and messages across restart', () => {
    const { db, file, projectId } = setup()
    const storedIncident = incident(projectId)
    const storedConversation = conversation(projectId)
    db.saveDiagnosticIncident(storedIncident)
    db.createConversation(storedConversation)
    db.saveAgentMessage(message(storedConversation.id, 'user', 'completed'))
    db.saveAgentMessage(message(storedConversation.id, 'assistant', 'completed'))
    db.setCurrentConversation(projectId, storedConversation.id)
    db.close()

    const reopened = new AppDatabase(file)
    expect(reopened.listActiveDiagnosticIncidents(projectId)).toEqual([storedIncident])
    expect(reopened.listConversations(projectId)).toEqual([storedConversation])
    expect(reopened.listAgentMessages(projectId, storedConversation.id)).toHaveLength(2)
    expect(reopened.getCurrentConversationId(projectId)).toBe(storedConversation.id)
    reopened.close()
  })

  it('supersedes the previous active incident and resolves only requested kinds', () => {
    const { db, projectId, now } = setup()
    const compile = incident(projectId, ['compile'])
    const replacement = incident(projectId, ['compile'])
    db.saveDiagnosticIncident(compile)
    db.saveDiagnosticIncident(replacement)
    expect(db.listActiveDiagnosticIncidents(projectId).map(item => item.id)).toEqual([replacement.id])

    const runtime = incident(projectId, ['runtime'])
    runtime.targetKey = replacement.targetKey
    runtime.operation = 'run'
    db.saveDiagnosticIncident(runtime)
    db.resolveDiagnosticIncidents(projectId, replacement.targetKey, ['compile', 'linker'], now)
    expect(db.listActiveDiagnosticIncidents(projectId).map(item => item.id)).toEqual([runtime.id])
    db.close()
  })

  it('keeps conversations isolated by project and archives explicitly', () => {
    const { db, projectId } = setup()
    const project = db.getProject(projectId)!
    const otherProject = { ...project, id: crypto.randomUUID(), name: 'Other', relativeRoot: 'other' }
    db.saveProject(otherProject)
    const first = db.createConversation(conversation(projectId))
    db.createConversation(conversation(otherProject.id))
    expect(db.listConversations(projectId).map(item => item.id)).toEqual([first.id])
    expect(db.archiveConversation(projectId, first.id).status).toBe('archived')
    expect(db.listConversations(projectId)).toEqual([])
    db.close()
  })

  it('recovers unfinished assistant messages as interrupted', () => {
    const { db, file, projectId } = setup()
    const item = db.createConversation(conversation(projectId))
    const streaming = message(item.id, 'assistant', 'streaming')
    db.saveAgentMessage(streaming)
    db.close()

    const reopened = new AppDatabase(file)
    expect(reopened.listAgentMessages(projectId, item.id)[0]).toMatchObject({ id: streaming.id, status: 'interrupted' })
    reopened.close()
  })

  it('keeps insertion order when messages share a timestamp, including after updates and restart', () => {
    const { db, file, projectId, now } = setup()
    const item = db.createConversation(conversation(projectId))
    const user: AgentMessage = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      conversationId: item.id,
      role: 'user',
      kind: 'text',
      content: '请解释这个错误',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now
    }
    const assistant: AgentMessage = {
      id: '00000000-0000-4000-8000-000000000000',
      conversationId: item.id,
      role: 'assistant',
      kind: 'text',
      content: '',
      status: 'streaming',
      createdAt: now,
      updatedAt: now
    }
    db.saveAgentMessage(user)
    db.saveAgentMessage(assistant)
    db.saveAgentMessage({ ...assistant, content: '先看编译器提示。', status: 'completed', completedAt: now })

    expect(db.listAgentMessages(projectId, item.id).map(message => message.id)).toEqual([user.id, assistant.id])
    db.close()

    const reopened = new AppDatabase(file)
    expect(reopened.listAgentMessages(projectId, item.id).map(message => message.id)).toEqual([user.id, assistant.id])
    reopened.close()
  })
})
