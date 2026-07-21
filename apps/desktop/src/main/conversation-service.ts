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

  getOrCreateActiveConversation(input: { projectId: string; conversationId?: string }): AgentConversation {
    if (input.conversationId) return this.requireConversation(input.projectId, input.conversationId)
    this.requireProject(input.projectId)
    const conversations = this.options.db.listConversations(input.projectId)
    const currentId = this.options.db.getCurrentConversationId(input.projectId)
    const current = currentId ? conversations.find(item => item.id === currentId) : undefined
    if (current) return current
    const first = conversations[0]
    if (first) return first
    return this.create({ projectId: input.projectId })
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
    const current = this.options.db.listAgentMessages(run.projectId, run.conversationId)
      .find(message => message.id === run.assistantMessageId)
    if (!current) return null
    const now = this.now()
    const patch = this.messagePatchForRun(run)
    const nextCompletedAt = patch.completed ? run.completedAt ?? now : undefined
    if (
      current.status === patch.status
      && current.content === patch.content
      && (current.errorCode ?? undefined) === (run.errorCode ?? undefined)
      && (current.errorMessage ?? undefined) === (run.errorMessage ?? undefined)
      && (current.completedAt ?? undefined) === (nextCompletedAt ?? undefined)
    ) return current

    const { completedAt: _completedAt, errorCode: _errorCode, errorMessage: _errorMessage, ...messageBase } = current
    const message: AgentMessage = {
      ...messageBase,
      content: patch.content,
      status: patch.status,
      ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      updatedAt: now,
      ...(nextCompletedAt ? { completedAt: nextCompletedAt } : {})
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
    const kind: AgentMessage['kind'] = input.screenshot ? 'screenshot-question' : input.diagnostic ? 'diagnostic-explanation' : 'text'
    const user: AgentMessage = {
      id: randomUUID(), conversationId: input.conversationId, role: 'user',
      kind, content: input.message.trim(), status: 'completed',
      ...(input.diagnostic ? { diagnosticSnapshot: input.diagnostic } : {}),
      ...(input.screenshot ? { screenshot: input.screenshot } : {}),
      createdAt: now, updatedAt: now, completedAt: now
    }
    const assistant: AgentMessage = {
      id: randomUUID(), conversationId: input.conversationId, role: 'assistant', kind,
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

  private messagePatchForRun(run: AgentRun): { status: AgentMessage['status']; content: string; completed: boolean } {
    const response = run.response?.trim()
    if (run.status === 'waiting-input') {
      return { status: 'completed', content: run.pendingClarification?.question?.trim() || response || '需要补充信息。', completed: true }
    }
    if (run.status === 'completed') {
      return { status: 'completed', content: response || '任务已完成。', completed: true }
    }
    if (run.status === 'failed') {
      return { status: 'failed', content: response || this.failureContentFor(run), completed: true }
    }
    if (run.status === 'cancelled') {
      return { status: 'stopped', content: response || '任务已取消。', completed: true }
    }
    return { status: 'streaming', content: response || this.activeContentFor(run), completed: false }
  }

  private activeContentFor(run: AgentRun): string {
    switch (run.status) {
      case 'queued': return '任务已排队。'
      case 'contextualizing': return '正在整理上下文。'
      case 'waiting-model-approval': return '等待确认发送模型上下文。'
      case 'model-requesting': return '正在请求模型。'
      case 'validating-model-output': return '正在校验模型响应。'
      case 'planning': return '正在规划步骤。'
      case 'policy-check': return '正在检查操作权限。'
      case 'waiting-approval': return '等待确认工具操作。'
      case 'executing': return '正在执行操作。'
      case 'validating': return '正在验证结果。'
      case 'responding': return '正在整理回答。'
      default: return '助教正在处理。'
    }
  }

  private failureContentFor(run: AgentRun): string {
    switch (run.errorCode) {
      case 'MODEL_NOT_CONFIGURED': return '尚未配置可用模型。'
      case 'MODEL_REQUEST_FAILED': return 'OpenAI 请求失败，回答未完成。'
      case 'MODEL_TIMEOUT': return 'OpenAI 请求超时，回答未完成。'
      case 'MODEL_PROTOCOL_INVALID': return '模型返回格式无效，回答未完成。'
      default: return run.errorMessage?.trim() || '任务未能完成。'
    }
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