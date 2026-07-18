<script setup lang="ts">
import { ref } from 'vue'
import { Send, Square } from 'lucide-vue-next'
import type { AgentStartRequest } from '@cpp-pet/contracts'
import { createAgentRequest } from '../utils/agent-request'

const props = withDefaults(defineProps<{
  source?: AgentStartRequest['source']
  projectId?: string | undefined
  activeFile?: string | undefined
  selection?: NonNullable<AgentStartRequest['selection']> | undefined
  diagnostics?: NonNullable<AgentStartRequest['diagnostics']> | undefined
  busy?: boolean
  suggestion?: { label: string; message: string } | undefined
}>(), { source: 'main', busy: false })
const emit = defineEmits<{
  submit: [request: AgentStartRequest]
  cancel: []
  'suggestion-selected': []
}>()
const message = ref('')

function selectSuggestion() {
  if (!props.suggestion || props.busy) return
  message.value = props.suggestion.message
  emit('suggestion-selected')
}

function submit() {
  if (!message.value.trim() || props.busy) return
  emit('submit', createAgentRequest(message.value, {
    source: props.source,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(props.activeFile ? { activeFile: props.activeFile } : {}),
    ...(props.selection ? { selection: props.selection } : {}),
    ...(props.diagnostics ? { diagnostics: props.diagnostics } : {})
  }))
  message.value = ''
}
</script>

<template>
  <form class="agent-composer" @submit.prevent="submit">
    <button v-if="suggestion" type="button" class="agent-suggestion" :disabled="busy" @click="selectSuggestion">{{ suggestion.label }}</button>
    <textarea v-model="message" rows="2" maxlength="20000" placeholder="向 CppPilot 提交学习任务" @keydown.ctrl.enter="submit" />
    <button v-if="busy" type="button" class="icon-command stop" title="停止 Agent" @click="emit('cancel')"><Square :size="16" /></button>
    <button v-else type="submit" class="primary-command" :disabled="!message.trim()"><Send :size="15" />发送</button>
  </form>
</template>
