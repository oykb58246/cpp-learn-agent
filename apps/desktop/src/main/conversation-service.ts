import { randomUUID } from 'node:crypto'
import type {
  AgentConversation,
  AgentMessage,
  AgentRun,
  ConversationArchiveInput,
  ConversationChangedEvent,
  ConversationCreateInput,
  ConversationMessagesInput,
  ConversationSendInput,
  ConversationSendResult
} from '@cpp-pet/contracts'
import { AppDatabase } from '@cpp-pet/database'

interface ConversationServiceOptions {
  db: AppDatabase
  now?: () => string
}

export class ConversationService {
  private readonly changeListeners = new Set<(event: ConversationChangedEvent) => void>()
  private readonly now: () => string

  constructor(private readonly options: ConversationServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  list(input: { projectId: string }): AgentConversation[] {
    this.requireProject(input.projectId)
    const conversations = this.options.db.listConversations(input.projectId)
    if (!conversations.length) return [this.create({ projectId: input.projectId })]
    const currentId = this.options.db.getCurrentConversationId(input.projectId)
    if (!currentId) return conversations
    const currentIndex = conversations.findIndex(item => item.id === currentId)
    if (currentIndex <= 0) return conversations
    const [current] = conversations.splice(currentIndex, 1)
    if (current) conversations.unshift(current)
    return conversations
  }

  create(input: ConversationCreateInput): AgentConversation {
    this.requireProject(input.projectId)
    const now = this.now()
    const conversation = this.options.db.createConversation({
      id: randomUUID(), projectId: input.projectId, title: input.title?.trim() || '新对话',
      status: 'active', createdAt: now, updatedAt: now
    })
    this.options.db.setCurrentConversation(input.projectId, conversation.id)
    this.emitChanged({ kind: 'conversation', projectId: input.projectId, conversation })
    return conversation
  }

  archive(input: ConversationArchiveInput): AgentConversation {
    this.requireConversation(input.projectId, input.conversationId)
    const conversation = this.options.db.archiveConversation(input.projectId, input.conversationId)
    this.emitChanged({ kind: 'conversation', projectId: input.projectId, conversation })
    return conversation
  }

  messages(input: ConversationMessagesInput): AgentMessage[] {
    this.requireConversation(input.projectId, input.conversationId)
    this.options.db.setCurrentConversation(input.projectId, input.conversationId)
    return this.options.db.listAgentMessages(input.projectId, input.conversationId)
  }

  beginAgentTask(input: ConversationSendInput): ConversationSendResult {
    return this.createExchange(input)
  }

  handleAgentRunChanged(run: AgentRun): AgentMessage | null {
    if (!run.projectId || !run.conversationId || !run.assistantMessageId) return null
    if (!['waiting-input', 'completed', 'failed', 'cancelled'].includes(run.status)) return null
    const current = this.options.db.listAgentMessages(run.projectId, run.conversationId)
      .find(message => message.id === run.assistantMessageId)
    if (!current) return null
    const now = this.now()
    const status: AgentMessage['status'] = run.status === 'waiting-input' || run.status === 'completed'
      ? 'completed'
      : run.status === 'cancelled' ? 'stopped' : 'failed'
    const content = run.status === 'waiting-input'
      ? run.pendingClarification?.question ?? run.response?.trim() ?? '需要补充信息。'
      : run.response?.trim() || (run.status === 'failed' ? '任务未能完成。' : '任务已停止。')
    if (current.status === status && current.content === content) return current
    const message: AgentMessage = {
      ...current, content, status,
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      updatedAt: now, completedAt: now
    }
    this.options.db.saveAgentMessage(message)
    this.touchConversation(run.projectId, run.conversationId, now)
    this.emitChanged({ kind: 'message', projectId: run.projectId, message })
    return message
  }

  onChanged(listener: (event: ConversationChangedEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  shutdown(): void {}

  private createExchange(input: ConversationSendInput): ConversationSendResult {
    const conversation = this.requireConversation(input.projectId, input.conversationId)
    const now = this.now()
    const user: AgentMessage = {
      id: randomUUID(), conversationId: input.conversationId, role: 'user',
      kind: input.diagnostic ? 'diagnostic-explanation' : 'text', content: input.message.trim(), status: 'completed',
      ...(input.diagnostic ? { diagnosticSnapshot: input.diagnostic } : {}), createdAt: now, updatedAt: now, completedAt: now
    }
    const assistant: AgentMessage = {
      id: randomUUID(), conversationId: input.conversationId, role: 'assistant', kind: user.kind,
      content: '', status: 'pending', createdAt: now, updatedAt: now
    }
    this.options.db.transaction(() => {
      this.options.db.saveAgentMessage(user)
      this.options.db.saveAgentMessage(assistant)
      const title = conversation.title === '新对话' ? this.titleFor(input) : conversation.title
      this.options.db.updateConversation({ ...conversation, title, updatedAt: now })
      this.options.db.setCurrentConversation(input.projectId, input.conversationId)
    })
    this.emitChanged({ kind: 'message', projectId: input.projectId, message: user })
    this.emitChanged({ kind: 'message', projectId: input.projectId, message: assistant })
    return { user, assistant }
  }

  private touchConversation(projectId: string, conversationId: string, at: string): void {
    const conversation = this.requireConversation(projectId, conversationId)
    const updated = this.options.db.updateConversation({ ...conversation, updatedAt: at })
    this.emitChanged({ kind: 'conversation', projectId, conversation: updated })
  }

  private titleFor(input: ConversationSendInput): string {
    return (input.diagnostic?.title ?? input.message).trim().replace(/\s+/g, ' ').slice(0, 36) || '新对话'
  }

  private requireProject(projectId: string): void {
    if (!this.options.db.getProject(projectId)) throw new Error('Project not found')
  }

  private requireConversation(projectId: string, conversationId: string): AgentConversation {
    this.requireProject(projectId)
    const conversation = this.options.db.listConversations(projectId).find(item => item.id === conversationId)
    if (!conversation) throw new Error('Conversation not found')
    return conversation
  }

  private emitChanged(event: ConversationChangedEvent): void {
    for (const listener of this.changeListeners) listener(structuredClone(event))
  }
}
