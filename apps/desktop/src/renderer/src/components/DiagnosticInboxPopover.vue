<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ChevronDown, ChevronRight, MapPin, MessageSquarePlus, MessagesSquare, X } from 'lucide-vue-next'
import type { DiagnosticExplanationSnapshot, DiagnosticInboxGroup, DiagnosticOccurrence } from '@cpp-pet/contracts'
import { nextExpandedFingerprint, toDiagnosticSnapshot } from '../utils/diagnostic-inbox'

const props = defineProps<{ groups: DiagnosticInboxGroup[] }>()
const emit = defineEmits<{
  acknowledge: []
  close: []
  navigate: [occurrence: DiagnosticOccurrence]
  explain: [snapshot: DiagnosticExplanationSnapshot, createNew: boolean]
}>()
const expanded = ref<string | null>(null)

const kindLabel: Record<DiagnosticInboxGroup['failureKind'], string> = {
  compile: '编译错误', linker: '链接错误', runtime: '运行时错误', 'nonzero-exit': '异常退出', timeout: '运行超时'
}

onMounted(() => emit('acknowledge'))

function toggle(group: DiagnosticInboxGroup) {
  expanded.value = nextExpandedFingerprint(expanded.value, group.fingerprint)
}

function explain(group: DiagnosticInboxGroup, createNew: boolean) {
  emit('explain', toDiagnosticSnapshot(group), createNew)
}
</script>

<template>
  <section class="diagnostic-inbox-popover" role="dialog" aria-label="错误收件箱">
    <header>
      <div><strong>错误收件箱</strong><span>{{ groups.length }} 组未解决问题</span></div>
      <button class="icon-command" type="button" title="关闭错误收件箱" @click="emit('close')"><X :size="15" /></button>
    </header>
    <div class="diagnostic-inbox-list">
      <article v-for="group in groups" :key="group.fingerprint" class="diagnostic-inbox-group">
        <button class="diagnostic-group-summary" type="button" :aria-expanded="expanded === group.fingerprint" @click="toggle(group)">
          <ChevronDown v-if="expanded === group.fingerprint" :size="15" />
          <ChevronRight v-else :size="15" />
          <span><strong>{{ group.title }}</strong><small>{{ kindLabel[group.failureKind] }} · {{ group.occurrenceCount }} 处</small></span>
        </button>
        <div v-if="expanded === group.fingerprint" class="diagnostic-group-details">
          <div class="diagnostic-occurrences">
            <button
              v-for="occurrence in group.occurrences"
              :key="occurrence.id"
              type="button"
              :disabled="!occurrence.file || !occurrence.line"
              @click="emit('navigate', occurrence)"
            >
              <MapPin :size="14" />
              <span>{{ occurrence.file || '程序输出' }}<template v-if="occurrence.line">:{{ occurrence.line }}<template v-if="occurrence.column">:{{ occurrence.column }}</template></template></span>
              <small>{{ occurrence.normalizedMessage }}</small>
            </button>
          </div>
          <div class="diagnostic-explain-actions">
            <button type="button" @click="explain(group, false)"><MessagesSquare :size="14" />加入当前对话</button>
            <button type="button" @click="explain(group, true)"><MessageSquarePlus :size="14" />创建新对话</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
