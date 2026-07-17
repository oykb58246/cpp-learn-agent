import { randomUUID } from 'node:crypto'
import type {
  AgentConversation,
  AgentMessage,
  ConversationArchiveInput,
  ConversationChangedEvent,
  ConversationCreateInput,
  ConversationMessageDelta,
  ConversationMessagesInput,
  ConversationRetryInput,
  ConversationSendInput,
  ConversationSendResult,
  ConversationStopInput,
  KnowledgeNode
} from '@cpp-pet/contracts'
import {
  assembleConversationMessages,
  type StreamingCompletionInput
} from '@cpp-pet/agent-runtime'
import { AppDatabase } from '@cpp-pet/database'

export interface ConversationStreamingGateway {
  stream(input: StreamingCompletionInput, signal: AbortSignal, onDelta: (delta: string) => void | Promise<void>): Promise<void>
}

interface ConversationServiceOptions {
  db: AppDatabase
  workspace: { readFile(projectId: string, relativePath: string): { relativePath: string; content: string } }
  secrets: { get(profileId: string): string | undefined }
  gateway: ConversationStreamingGateway
  nodes: KnowledgeNode[]
  now?: () => string
  flushIntervalMs?: number
}

interface ActiveGeneration {
  projectId: string
  conversationId: string
  assistantId: string
  kind: AgentMessage['kind']
  controller: AbortController
  content: string
  persistedLength: number
  sequence: number
  stopped: boolean
  flushTimer: ReturnType<typeof setTimeout> | undefined
}

export class ConversationService {
  private readonly active = new Map<string, ActiveGeneration>()
  private readonly deltaListeners = new Set<(event: ConversationMessageDelta) => void>()
  private readonly changeListeners = new Set<(event: ConversationChangedEvent) => void>()
  private readonly now: () => string
  private readonly flushIntervalMs: number

  constructor(private readonly options: ConversationServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.flushIntervalMs = options.flushIntervalMs ?? 250
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
      id: randomUUID(), projectId: input.projectId, title: input.title?.trim() || '新对话', status: 'active', createdAt: now, updatedAt: now
    })
    this.options.db.setCurrentConversation(input.projectId, conversation.id)
    this.emitChanged({ kind: 'conversation', projectId: input.projectId, conversation })
    return conversation
  }

  archive(input: ConversationArchiveInput): AgentConversation {
    this.requireConversation(input.projectId, input.conversationId)
    if (this.active.has(input.conversationId)) throw new Error('Cannot archive a streaming conversation')
    const conversation = this.options.db.archiveConversation(input.projectId, input.conversationId)
    this.emitChanged({ kind: 'conversation', projectId: input.projectId, conversation })
    return conversation
  }

  messages(input: ConversationMessagesInput): AgentMessage[] {
    this.requireConversation(input.projectId, input.conversationId)
    this.options.db.setCurrentConversation(input.projectId, input.conversationId)
    return this.options.db.listAgentMessages(input.projectId, input.conversationId)
  }

  send(input: ConversationSendInput): ConversationSendResult {
    const conversation = this.requireConversation(input.projectId, input.conversationId)
    if (this.active.has(input.conversationId)) throw new Error('Conversation is already streaming')
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
    this.startGeneration(input, user, assistant)
    return { user, assistant }
  }

  stop(input: ConversationStopInput): AgentMessage | null {
    this.requireConversation(input.projectId, input.conversationId)
    const active = this.active.get(input.conversationId)
    if (!active || active.projectId !== input.projectId) return null
    active.stopped = true
    active.controller.abort(new DOMException('Stopped by user', 'AbortError'))
    if (active.flushTimer) clearTimeout(active.flushTimer)
    const now = this.now()
    const message = this.messageFromActive(active, 'stopped', now)
    this.options.db.saveAgentMessage(message)
    active.persistedLength = active.content.length
    this.active.delete(input.conversationId)
    this.emitChanged({ kind: 'message', projectId: input.projectId, message })
    return message
  }

  retry(input: ConversationRetryInput): ConversationSendResult {
    const messages = this.messages({ projectId: input.projectId, conversationId: input.conversationId })
    const index = messages.findIndex(item => item.id === input.messageId)
    const failed = messages[index]
    if (!failed || failed.role !== 'assistant' || !['failed', 'stopped', 'interrupted'].includes(failed.status)) throw new Error('Message cannot be retried')
    const user = messages.slice(0, index).reverse().find(item => item.role === 'user')
    if (!user) throw new Error('Original user message not found')
    if (this.active.has(input.conversationId)) throw new Error('Conversation is already streaming')
    const now = this.now()
    const assistant: AgentMessage = {
      id: randomUUID(), conversationId: input.conversationId, role: 'assistant', kind: user.kind,
      content: '', status: 'pending', createdAt: now, updatedAt: now
    }
    this.options.db.saveAgentMessage(assistant)
    this.emitChanged({ kind: 'message', projectId: input.projectId, message: assistant })
    this.startGeneration({
      projectId: input.projectId, conversationId: input.conversationId, message: user.content,
      ...(user.diagnosticSnapshot ? { diagnostic: user.diagnosticSnapshot } : {})
    }, user, assistant)
    return { user, assistant }
  }

  onDelta(listener: (event: ConversationMessageDelta) => void): () => void {
    this.deltaListeners.add(listener)
    return () => this.deltaListeners.delete(listener)
  }

  onChanged(listener: (event: ConversationChangedEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  shutdown(): void {
    for (const active of this.active.values()) active.controller.abort(new DOMException('Application shutdown', 'AbortError'))
  }

  private startGeneration(input: ConversationSendInput, user: AgentMessage, assistant: AgentMessage): void {
    const active: ActiveGeneration = {
      projectId: input.projectId, conversationId: input.conversationId, assistantId: assistant.id,
      kind: assistant.kind, controller: new AbortController(), content: '', persistedLength: 0, sequence: 0, stopped: false,
      flushTimer: undefined
    }
    this.active.set(input.conversationId, active)
    void this.generate(input, user, assistant, active)
  }

  private async generate(input: ConversationSendInput, user: AgentMessage, assistant: AgentMessage, active: ActiveGeneration): Promise<void> {
    try {
      const streaming = { ...assistant, status: 'streaming' as const, updatedAt: this.now() }
      this.options.db.saveAgentMessage(streaming)
      this.emitChanged({ kind: 'message', projectId: input.projectId, message: streaming })
      const profile = this.options.db.listModelProfiles().find(item => item.enabled)
      const apiKey = profile ? this.options.secrets.get(profile.id) : undefined
      if (!profile || !apiKey) throw new ConversationServiceError('MODEL_NOT_CONFIGURED', '尚未配置可用的模型服务。')
      const stored = this.options.db.listAgentMessages(input.projectId, input.conversationId)
      const activeFilePath = input.activeFile ?? input.diagnostic?.occurrences.find(item => item.file)?.file
      const activeFile = activeFilePath ? this.options.workspace.readFile(input.projectId, activeFilePath) : undefined
      const prompt = assembleConversationMessages({
        nodes: this.options.nodes,
        profile: this.options.db.getBackgroundProfile('local-user'),
        history: stored.filter(item => item.id !== user.id && item.id !== assistant.id),
        userMessage: user.content,
        ...(activeFile ? { activeFile } : {}),
        ...(input.selection ? { selection: input.selection } : {}),
        ...(input.diagnostic ? { diagnostic: input.diagnostic } : {})
      })
      await this.options.gateway.stream({ profile, apiKey, messages: prompt }, active.controller.signal, async delta => {
        if (active.stopped || !delta) return
        active.content += delta
        const event: ConversationMessageDelta = {
          projectId: input.projectId, conversationId: input.conversationId, messageId: assistant.id,
          sequence: active.sequence++, delta
        }
        for (const listener of this.deltaListeners) listener(structuredClone(event))
        if (active.content.length - active.persistedLength >= 1_024) this.flush(active, 'streaming')
        else this.scheduleFlush(active)
      })
      if (active.stopped) return
      if (!active.content.trim()) throw new ConversationServiceError('MODEL_EMPTY_RESPONSE', '模型没有返回回答内容。')
      if (active.flushTimer) clearTimeout(active.flushTimer)
      const now = this.now()
      const completed = this.messageFromActive(active, 'completed', now)
      this.options.db.saveAgentMessage(completed)
      this.touchConversation(input.projectId, input.conversationId, now)
      this.emitChanged({ kind: 'message', projectId: input.projectId, message: completed })
    } catch (error) {
      if (active.stopped) return
      if (active.flushTimer) clearTimeout(active.flushTimer)
      const now = this.now()
      const failed: AgentMessage = {
        ...this.messageFromActive(active, 'failed', now),
        errorCode: error instanceof ConversationServiceError ? error.code : 'MODEL_REQUEST_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
      this.options.db.saveAgentMessage(failed)
      this.emitChanged({ kind: 'message', projectId: input.projectId, message: failed })
    } finally {
      if (this.active.get(input.conversationId) === active) this.active.delete(input.conversationId)
    }
  }

  private scheduleFlush(active: ActiveGeneration): void {
    if (active.flushTimer) return
    active.flushTimer = setTimeout(() => {
      active.flushTimer = undefined
      if (!active.stopped && active.content.length !== active.persistedLength) this.flush(active, 'streaming')
    }, this.flushIntervalMs)
  }

  private flush(active: ActiveGeneration, status: AgentMessage['status']): void {
    const message = this.messageFromActive(active, status, this.now())
    this.options.db.saveAgentMessage(message)
    active.persistedLength = active.content.length
  }

  private messageFromActive(active: ActiveGeneration, status: AgentMessage['status'], now: string): AgentMessage {
    return {
      id: active.assistantId, conversationId: active.conversationId, role: 'assistant', kind: active.kind,
      content: active.content, status, createdAt: this.messageCreatedAt(active), updatedAt: now,
      ...(['completed', 'stopped', 'failed', 'interrupted'].includes(status) ? { completedAt: now } : {})
    }
  }

  private messageCreatedAt(active: ActiveGeneration): string {
    const stored = this.options.db.listAgentMessages(active.projectId, active.conversationId).find(item => item.id === active.assistantId)
    return stored?.createdAt ?? this.now()
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

class ConversationServiceError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
