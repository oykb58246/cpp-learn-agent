<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bot, Filter, RefreshCw } from 'lucide-vue-next'
import type { AgentStartRequest } from '@cpp-pet/contracts'
import { useAgentStore } from '../stores/agent'
import { useProductTourStore } from '../stores/product-tour'
import AgentComposer from '../components/AgentComposer.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import RunTimeline from '../components/RunTimeline.vue'
import { summarizeAssistantRecord } from '../utils/assistant-record'
import { agentTourSuggestion, beginnerTourSteps } from '../utils/product-tour'

const store = useAgentStore()
const tour = useProductTourStore()
const status = ref('all')
const filtered = computed(() => status.value === 'all' ? store.runs : store.runs.filter(run => run.status === status.value))
const timeline = computed(() => {
  const current = store.currentRun
  return current && 'timeline' in current ? current.timeline : []
})
const toolCalls = computed(() => {
  const current = store.currentRun
  return current && 'toolCalls' in current ? current.toolCalls : []
})
const active = computed(() => store.currentRun && !['completed', 'failed', 'cancelled'].includes(store.currentRun.status))
const tourStep = computed(() => beginnerTourSteps[tour.currentStepIndex])
const showTourSuggestion = computed(() => tour.open && tourStep.value?.id === 'assistant-input')
const summaryFor = summarizeAssistantRecord

onMounted(async () => {
  store.subscribe()
  await store.refreshAll()
  if (!store.currentRun && store.runs[0]) await store.selectRun(store.runs[0].id)
})
onBeforeUnmount(() => store.dispose())

async function submit(request: AgentStartRequest) {
  const run = await store.start(request)
  if (run && showTourSuggestion.value) tour.trackAgentRun(run.id)
}
async function decide(decision: 'approved' | 'rejected') {
  if (store.pendingApproval) await store.decide(store.pendingApproval.id, decision)
}
</script>

<template>
  <div class="h3-view runs-view">
    <section class="page-header"><div><p class="eyebrow">Assistant History</p><h1>助教记录</h1><p>集中查看历史报错与解决过程、助教给出的解释，以及下一步建议。</p></div><Bot :size="24" /></section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div>
    <div v-else-if="store.loading" class="h3-state">正在加载助教记录…</div>
    <div class="runs-toolbar">
      <label><Filter :size="14" /><select v-model="status"><option value="all">全部状态</option><option value="waiting-approval">等待审批</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
      <button class="icon-command" title="刷新" @click="store.refreshAll"><RefreshCw :size="15" /></button>
    </div>
    <div class="runs-layout">
      <aside class="run-list">
        <button v-for="run in filtered" :key="run.id" :class="{ active: store.currentRun?.id === run.id }" @click="store.selectRun(run.id)">
          <span :class="['status-dot', run.status]" /><div><strong>{{ summaryFor(run).title }}</strong><small>{{ summaryFor(run).summary }} · {{ new Date(run.updatedAt).toLocaleString() }}</small></div><b>{{ summaryFor(run).status }}</b>
        </button>
        <div v-if="!filtered.length" class="panel-empty">暂无 Agent 记录</div>
      </aside>
      <main class="run-detail">
        <template v-if="store.currentRun">
          <header data-tour="assistant-progress"><div><strong>{{ summaryFor(store.currentRun).title }}</strong><span>{{ summaryFor(store.currentRun).status }}</span></div><small>{{ summaryFor(store.currentRun).summary }}</small></header>
          <ApprovalCard v-if="store.pendingApproval" data-tour="assistant-approval" :approval="store.pendingApproval" :busy="store.running" @decide="decide" />
          <section
            v-if="store.currentRun.response"
            class="agent-response"
            :data-tour="store.currentRun.status === 'completed' ? 'assistant-result' : undefined"
          ><strong>助教解释与建议</strong><p>{{ store.currentRun.response }}</p></section>
          <p class="assistant-next-action"><strong>下一步：</strong>{{ summaryFor(store.currentRun).nextAction }}</p>
          <details class="assistant-technical-details"><summary>查看处理过程与技术细节</summary><RunTimeline :events="timeline" /><section v-if="toolCalls.length" class="tool-call-list"><header><strong>工具调用</strong><span>{{ toolCalls.length }}</span></header><article v-for="call in toolCalls" :key="call.id"><div><strong>{{ call.toolName }}</strong><small>{{ call.serverName }} · {{ call.risk }} · {{ call.status }}</small></div><code>{{ JSON.stringify(call.parameterSummary) }}</code><span>{{ call.result?.summary ?? call.errorCode ?? '执行中' }}</span><time>{{ call.durationMs ?? 0 }} ms</time></article></section></details>
        </template>
        <div v-else class="panel-empty">选择一条记录查看证据链</div>
      </main>
    </div>
    <section class="assistant-error-history">
      <header><div><strong>历史报错与解决过程</strong><span>从编译、运行和调试中保留的可追溯记录</span></div><span>{{ store.errors.length }} 条</span></header>
      <article v-for="entry in store.errors" :key="entry.id">
        <div><strong>{{ entry.title }}</strong><small>{{ entry.category }} · {{ new Date(entry.lastSeenAt).toLocaleString() }} · 出现 {{ entry.occurrences }} 次</small></div>
        <p>{{ entry.evidence }}</p><b>{{ entry.status === 'resolved' ? '已记录解决过程' : '建议在项目中继续处理' }}</b>
      </article>
      <div v-if="!store.errors.length" class="panel-empty">暂无历史报错。助教处理编译、运行或逻辑问题后，相关过程会显示在这里。</div>
    </section>
    <div class="runs-composer" data-tour="assistant-composer">
      <AgentComposer
        :busy="Boolean(active) || store.running"
        :suggestion="showTourSuggestion ? agentTourSuggestion : undefined"
        @submit="submit"
        @cancel="store.currentRun && store.cancel(store.currentRun.id)"
      />
    </div>
  </div>
</template>
