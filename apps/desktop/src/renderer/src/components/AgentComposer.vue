<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, ArrowUp, Hand, Plus, Shield, Square } from 'lucide-vue-next'
import type { AgentApprovalMode, AgentStartRequest } from '@cpp-pet/contracts'
import { createAgentRequest } from '../utils/agent-request'
import { captureScreenshotQuestion } from '../utils/screenshot-request'
import { useAppStore } from '../stores/app'

const props = withDefaults(defineProps<{
  source?: AgentStartRequest['source']
  projectId?: string | undefined
  activeFile?: string | undefined
  conversationId?: string | null | undefined
  selection?: NonNullable<AgentStartRequest['selection']> | undefined
  diagnostics?: NonNullable<AgentStartRequest['diagnostics']> | undefined
  busy?: boolean
  cancellable?: boolean
  suggestion?: { label: string; message: string } | undefined
}>(), { source: 'main', busy: false, cancellable: false })

const emit = defineEmits<{
  submit: [request: AgentStartRequest]
  cancel: []
  'suggestion-selected': []
}>()

const app = useAppStore()
const message = ref('')
const menuOpen = ref(false)
const canSend = computed(() => Boolean(message.value.trim()) && !props.busy)

const approvalModes: Array<{
  id: AgentApprovalMode
  label: string
  detail: string
  tone: 'always' | 'risk' | 'full'
  icon: typeof Hand
}> = [
  {
    id: 'always',
    label: '请求批准',
    detail: '每次模型上下文与操作都询问',
    tone: 'always',
    icon: Hand
  },
  {
    id: 'on-risk',
    label: '替我审批',
    detail: '仅高风险操作询问',
    tone: 'risk',
    icon: AlertTriangle
  },
  {
    id: 'full',
    label: '完全访问',
    detail: '自动执行，不再弹审批',
    tone: 'full',
    icon: Shield
  }
]

const currentMode = computed<AgentApprovalMode>(() => app.settings.agentApprovalMode ?? 'on-risk')
const currentApproval = computed(() => approvalModes.find(item => item.id === currentMode.value) ?? approvalModes[1]!)
const approvalLabel = computed(() => currentApproval.value.label)
const approvalTone = computed(() => currentApproval.value.tone)
const approvalIcon = computed(() => currentApproval.value.icon)

function selectSuggestion() {
  if (!props.suggestion || props.busy) return
  message.value = props.suggestion.message
  emit('suggestion-selected')
}

async function captureScreenshot() {
  if (props.busy) return
  await captureScreenshotQuestion(window.cppPet.screenshot, {
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(props.activeFile ? { activeFile: props.activeFile } : {}),
    ...(props.conversationId ? { conversationId: props.conversationId } : {})
  })
}

async function setApprovalMode(mode: AgentApprovalMode) {
  if (mode === currentMode.value) {
    menuOpen.value = false
    return
  }
  await app.updateSettings({ agentApprovalMode: mode })
  menuOpen.value = false
}

function toggleApprovalMenu() {
  if (props.busy) return
  menuOpen.value = !menuOpen.value
}

function submit() {
  if (!message.value.trim() || props.busy) return
  menuOpen.value = false
  emit('submit', createAgentRequest(message.value, {
    source: props.source,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(props.activeFile ? { activeFile: props.activeFile } : {}),
    ...(props.selection ? { selection: props.selection } : {}),
    ...(props.diagnostics ? { diagnostics: props.diagnostics } : {})
  }))
  message.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
    return
  }
  if (event.key === 'Escape') menuOpen.value = false
}
</script>

<template>
  <form class="agent-composer" @submit.prevent="submit">
    <button
      v-if="suggestion"
      type="button"
      class="agent-suggestion"
      :disabled="busy"
      @click="selectSuggestion"
    >{{ suggestion.label }}</button>

    <div class="composer-shell">
      <textarea
        v-model="message"
        rows="2"
        maxlength="20000"
        placeholder="随心输入"
        :disabled="busy"
        @keydown="onKeydown"
        @focus="menuOpen = false"
      />
      <div class="composer-toolbar">
        <div class="composer-toolbar-left">
          <button
            type="button"
            class="composer-icon-btn"
            title="截图提问"
            :disabled="busy"
            @click="captureScreenshot"
          >
            <Plus :size="16" />
          </button>

          <div class="composer-approval">
            <button
              type="button"
              class="composer-chip"
              :class="[approvalTone, { open: menuOpen }]"
              :title="`当前权限：${approvalLabel}（点击切换）`"
              :disabled="busy"
              :aria-expanded="menuOpen"
              aria-haspopup="menu"
              @click="toggleApprovalMenu"
            >
              <component :is="approvalIcon" :size="12" />
              {{ approvalLabel }}
            </button>
            <div v-if="menuOpen" class="composer-approval-menu" role="menu" aria-label="切换 Agent 权限">
              <button
                v-for="item in approvalModes"
                :key="item.id"
                type="button"
                role="menuitemradio"
                class="composer-approval-option"
                :class="[item.tone, { active: item.id === currentMode }]"
                :aria-checked="item.id === currentMode"
                @click="setApprovalMode(item.id)"
              >
                <component :is="item.icon" :size="14" />
                <span>
                  <strong>{{ item.label }}</strong>
                  <small>{{ item.detail }}</small>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div class="composer-toolbar-right">
          <button
            v-if="busy || cancellable"
            type="button"
            class="composer-send stop"
            title="停止"
            @click="emit('cancel')"
          >
            <Square :size="13" />
          </button>
          <button
            v-if="!busy"
            type="submit"
            class="composer-send"
            title="发送 (Enter)"
            :disabled="!canSend"
          >
            <ArrowUp :size="16" />
          </button>
        </div>
      </div>
      <small class="composer-keyboard-hint">Enter 发送 · Shift+Enter 换行</small>
    </div>
  </form>
</template>
