<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Archive, Bot, MessageSquarePlus, RotateCcw, Settings, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import type { AgentStartRequest, Diagnostic } from '@cpp-pet/contracts'
import type { AgentEditorSelection } from '../utils/editor-selection'
import { renderMarkdown } from '../utils/markdown'
import { useAgentStore } from '../stores/agent'
import { isAgentRunBusy } from '../utils/agent-run-state'
import AgentComposer from './AgentComposer.vue'

const props = withDefaults(defineProps<{
  projectId?: string | undefined
  activeFile?: string | undefined
  selection?: AgentEditorSelection | undefined
  diagnostics?: Diagnostic[] | undefined
  approvalPending?: boolean
  toolBusy?: boolean
  toolStatus?: string | undefined
}>(), { toolBusy: false, approvalPending: false, diagnostics: () => [] })
const emit = defineEmits<{ close: []; 'tool-submit': [request: AgentStartRequest]; 'cancel-tool': [] }>()
const agent = useAgentStore()
const router = useRouter()
const transcript = ref<HTMLElement | null>(null)
const currentConversation = computed(() => agent.conversations.find(item => item.id === agent.currentConversationId))
const streaming = computed(() => agent.messages.some(item => item.role === 'assistant' && ['pending', 'streaming'].includes(item.status)))
const activeTask = computed(() => Boolean(
  agent.currentRun
  && agent.currentRun.conversationId === agent.currentConversationId
  && isAgentRunBusy(agent.currentRun.status)
))
const cancellableTask = computed(() => Boolean(
  agent.currentRun
  && agent.currentRun.conversationId === agent.currentConversationId
  && agent.currentRun.status === 'waiting-input'
))

watch(() => agent.messages.map(item => `${item.id}:${item.content.length}:${item.status}`).join('|'), async () => {
  await nextTick()
  if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
})

async function submit(request: AgentStartRequest) {
  if (props.projectId && agent.agentProjectId !== props.projectId) await agent.loadProjectAgent(props.projectId)
  emit('tool-submit', request)
}

function retry(itemId: string) {
  const index = agent.messages.findIndex(item => item.id === itemId)
  const user = agent.messages.slice(0, index).reverse().find(item => item.role === 'user')
  if (!user) return
  emit('tool-submit', {
    source: 'editor', mode: 'auto', message: user.content,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(props.activeFile ? { activeFile: props.activeFile } : {}),
    ...(props.selection ? { selection: { ...props.selection } } : {}),
    ...(props.diagnostics?.length ? { diagnostics: props.diagnostics.map(item => ({ ...item, relatedConceptIds: [...item.relatedConceptIds] })) } : {})
  })
}

async function cancel() {
  if (activeTask.value || cancellableTask.value) emit('cancel-tool')
}

async function archiveCurrent() {
  if (!props.projectId || !agent.currentConversationId || streaming.value) return
  const result = await window.cppPet.conversations.archive({ projectId: props.projectId, conversationId: agent.currentConversationId })
  if (!result.ok) { agent.error = result.error; return }
  agent.handleConversationChanged({ kind: 'conversation', projectId: props.projectId, conversation: result.data })
  const next = agent.conversations[0]
  if (next) await agent.selectConversation(next.id)
  else await agent.createConversation()
}
</script>

<template>
  <section class="conversation-panel workspace-agent-panel" aria-label="CppPilot Agent 对话">
    <header>
      <div class="conversation-heading"><Bot :size="16" /><strong>CppPilot Agent</strong><span v-if="toolStatus">{{ toolStatus }}</span></div>
      <div class="conversation-commands">
        <select
          :value="agent.currentConversationId || ''"
          aria-label="当前对话"
          :disabled="agent.conversationLoading"
          @change="agent.selectConversation(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="item in agent.conversations" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
        <button class="icon-command" type="button" title="新建对话" @click="agent.createConversation()"><MessageSquarePlus :size="15" /></button>
        <button class="icon-command" type="button" title="归档当前对话" :disabled="!currentConversation || streaming" @click="archiveCurrent"><Archive :size="15" /></button>
        <button class="icon-command" type="button" title="关闭 Agent 面板" @click="emit('close')"><X :size="15" /></button>
      </div>
    </header>

    <div v-if="approvalPending" class="conversation-approval-view" aria-live="polite">
      <slot name="approval" />
    </div>
    <div v-else ref="transcript" class="conversation-transcript" aria-live="polite">
      <div v-if="agent.conversationLoading" class="conversation-empty">正在载入对话…</div>
      <div v-else-if="!agent.messages.length" class="conversation-empty">
        <Bot :size="22" />
        <strong>向助教提问</strong>
        <span>可以询问当前代码、C++ 概念，或从错误收件箱选择一组问题。</span>
      </div>
      <article v-for="item in agent.messages" v-else :key="item.id" :class="['conversation-message', item.role, item.status]">
        <div class="message-meta"><strong>{{ item.role === 'user' ? '你' : 'CppPilot' }}</strong><span>{{ item.status === 'streaming' ? '回答中' : item.status === 'stopped' ? '已停止' : item.status === 'failed' ? '请求失败' : item.status === 'interrupted' ? '已中断' : '' }}</span></div>
        <div v-if="item.content && item.role === 'assistant'" class="message-markdown" v-html="renderMarkdown(item.content)" />
        <p v-else-if="item.content">{{ item.content }}</p>
        <p v-else-if="item.status === 'pending' || item.status === 'streaming'" class="message-thinking">正在组织回答…</p>
        <div v-if="item.errorMessage" class="message-error">
          <span>{{ item.errorMessage }}</span>
          <button v-if="item.errorCode === 'MODEL_NOT_CONFIGURED'" type="button" @click="router.push('/settings')"><Settings :size="13" />模型设置</button>
        </div>
        <button v-if="['failed', 'stopped', 'interrupted'].includes(item.status)" class="message-retry" type="button" @click="retry(item.id)"><RotateCcw :size="13" />重试</button>
      </article>
    </div>

    <div v-if="agent.error" class="workspace-agent-error"><span>{{ agent.error.message }}</span></div>
    <AgentComposer
      source="editor"
      :project-id="projectId"
      :active-file="activeFile"
      :selection="selection"
      :diagnostics="diagnostics"
      :busy="streaming || activeTask || toolBusy"
      :cancellable="cancellableTask"
      @submit="submit"
      @cancel="cancel"
    />
  </section>
</template>
