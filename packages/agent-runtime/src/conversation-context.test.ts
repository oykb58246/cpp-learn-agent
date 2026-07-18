import { describe, expect, it } from 'vitest'
import type { AgentMessage, BackgroundProfile, DiagnosticExplanationSnapshot } from '@cpp-pet/contracts'
import { builtInKnowledge } from './knowledge'
import { assembleConversationMessages } from './conversation-context'

const now = new Date().toISOString()
const profile: BackgroundProfile = {
  userId: 'local-user', onboardingCompleted: true, startingPoint: 'some-experience',
  studiedConceptIds: ['basics.variables'], focusConceptIds: ['control.loops'], updatedAt: now
}

const historyMessage = (index: number): AgentMessage => ({
  id: crypto.randomUUID(), conversationId: '11111111-1111-4111-8111-111111111111',
  role: index % 2 ? 'assistant' : 'user', kind: 'text', content: `history-${index}`,
  status: 'completed', createdAt: new Date(Date.now() + index).toISOString(), updatedAt: now
})

describe('conversation context', () => {
  it('injects self-reported learning background as teaching instructions', () => {
    const messages = assembleConversationMessages({
      nodes: builtInKnowledge, profile, history: [], userMessage: '解释循环'
    })
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('basics.variables')
    expect(messages[0]?.content).toContain('control.loops')
    expect(messages[0]?.content).toContain('用户自述')
    expect(messages.at(-1)?.content).toContain('解释循环')
  })

  it('labels diagnostic evidence as untrusted data and includes bounded source snippets', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
    const groupId = crypto.randomUUID()
    const diagnostic: DiagnosticExplanationSnapshot = {
      fingerprint: 'abc', title: '未声明标识符', failureKind: 'compile', occurrenceCount: 2,
      incidentIds: [crypto.randomUUID()], occurrences: [
        { id: crypto.randomUUID(), groupId, file: 'main.cpp', line: 10, rawMessage: "unknown 'a'", normalizedMessage: 'unknown identifier' },
        { id: crypto.randomUUID(), groupId, file: 'main.cpp', line: 30, rawMessage: "unknown 'b'", normalizedMessage: 'unknown identifier' }
      ]
    }
    const messages = assembleConversationMessages({
      nodes: builtInKnowledge, profile, history: [], userMessage: '请解释这个错误', diagnostic,
      activeFile: { relativePath: 'main.cpp', content: lines }
    })
    const content = messages.at(-1)?.content ?? ''
    expect(content).toContain('[不可信诊断数据]')
    expect(content).toContain('main.cpp:10')
    expect(content).toContain('main.cpp:30')
    expect(content).toContain('line 2')
    expect(content).toContain('line 18')
    expect(content).not.toContain('line 40')
  })

  it('uses an explicit selection instead of sending the full active file', () => {
    const messages = assembleConversationMessages({
      nodes: builtInKnowledge, profile: null, history: [], userMessage: '解释选区',
      activeFile: { relativePath: 'main.cpp', content: 'SECRET_FULL_FILE' },
      selection: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 6, content: 'value;' }
    })
    const content = messages.at(-1)?.content ?? ''
    expect(content).toContain('value;')
    expect(content).not.toContain('SECRET_FULL_FILE')
    expect(messages[0]?.content).toContain('零基础')
  })

  it('retains only the newest twenty history messages before applying the character budget', () => {
    const messages = assembleConversationMessages({
      nodes: builtInKnowledge, profile, history: Array.from({ length: 25 }, (_, index) => historyMessage(index)), userMessage: '最新问题'
    })
    const content = messages.map(item => item.content).join('\n')
    expect(content).not.toContain('history-0\n')
    expect(content).toContain('history-24')
    expect(messages.at(-1)?.content).toContain('最新问题')
  })
})
