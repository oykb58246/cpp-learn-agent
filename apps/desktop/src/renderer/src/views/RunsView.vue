<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Filter, RefreshCw, Search, X } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import type { AgentStartRequest } from '@cpp-pet/contracts'
import { useAgentStore } from '../stores/agent'
import { useProductTourStore } from '../stores/product-tour'
import AgentComposer from '../components/AgentComposer.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import RunTimeline from '../components/RunTimeline.vue'
import { summarizeAssistantRecord } from '../utils/assistant-record'
import { isAgentRunBusy } from '../utils/agent-run-state'
import { agentTourSuggestion, beginnerTourSteps } from '../utils/product-tour'
import { renderMarkdown } from '../utils/markdown'

const store = useAgentStore()
const tour = useProductTourStore()
const route = useRoute()
const status = ref('all')
const query = ref('')
const fromDate = ref('')
const toDate = ref('')
const hasFilters = computed(() => Boolean(status.value !== 'all' || query.value || fromDate.value || toDate.value))
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const filtered = computed(() => store.runs.filter(run => {
  if (status.value !== 'all' && run.status !== status.value) return false
  if (!isInDateRange(run.updatedAt)) return false
  return !normalizedQuery.value || runSearchText(run).includes(normalizedQuery.value)
}))
const filteredErrors = computed(() => store.errors.filter(entry => {
  if (!isInDateRange(entry.lastSeenAt)) return false
  if (!normalizedQuery.value) return true
  return [entry.title, entry.category, entry.evidence, entry.relativePath, entry.status]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery.value)
}))
const timeline = computed(() => {
  const current = store.currentRun
  return current && 'timeline' in current ? current.timeline : []
})
const toolCalls = computed(() => {
  const current = store.currentRun
  return current && 'toolCalls' in current ? current.toolCalls : []
})
const active = computed(() => isAgentRunBusy(store.currentRun?.status))
const timelineOpen = computed(() => route.query.view === 'timeline' || route.query.panel === 'timeline')
const tourStep = computed(() => beginnerTourSteps[tour.currentStepIndex])
const showTourSuggestion = computed(() => tour.open && tourStep.value?.id === 'assistant-input')
const summaryFor = summarizeAssistantRecord

function runSearchText(run: typeof store.runs[number]) {
  const summary = summaryFor(run)
  return [summary.title, summary.summary, summary.status, run.message, run.response, run.intent,
    run.planSummary, run.validationSummary, run.errorMessage, run.activeFile, run.mode, run.status]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
}

function isInDateRange(value: string) {
  const date = value.slice(0, 10)
  return (!fromDate.value || date >= fromDate.value) && (!toDate.value || date <= toDate.value)
}

function clearFilters() {
  status.value = 'all'
  query.value = ''
  fromDate.value = ''
  toDate.value = ''
}

onMounted(async () => {
  store.subscribe()
  await store.refreshAll()
  await selectRouteRun()
  if (!store.currentRun && store.runs[0]) await store.selectRun(store.runs[0].id)
})
onBeforeUnmount(() => store.dispose())
watch(() => route.query.runId, () => { void selectRouteRun() })

async function selectRouteRun() {
  const runId = typeof route.query.runId === 'string' ? route.query.runId : undefined
  if (runId) await store.selectRun(runId)
}

async function submit(request: AgentStartRequest) {
  const current = store.currentRun
  const run = current?.status === 'waiting-input'
    ? await store.continue(current.id, request.message)
    : await store.start(request)
  if (run && showTourSuggestion.value) tour.trackAgentRun(run.id)
}
async function decide(decision: 'approved' | 'rejected') {
  if (store.pendingApproval) await store.decide(store.pendingApproval.id, decision)
}
</script>

<template>
  <div class="h3-view runs-view">
    <section class="page-header page-header-plain" data-page="runs">
      <div>
        <p class="eyebrow">Assistant History</p>
        <h1>助教记录</h1>
        <p>集中查看历史报错与解决过程、助教给出的解释，以及下一步建议。</p>
      </div>
    </section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div>
    <div v-else-if="store.loading" class="h3-state">正在加载助教记录…</div>
    <div class="runs-toolbar">
      <div class="runs-filters">
        <label class="runs-search"><Search :size="14" /><input v-model="query" type="search" placeholder="检索内容、路径或状态" aria-label="检索助教记录" /></label>
        <label><Filter :size="14" /><select v-model="status" aria-label="按状态筛选"><option value="all">全部状态</option><option value="waiting-approval">等待审批</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
        <label class="runs-date"><span>更新日期</span><input v-model="fromDate" type="date" aria-label="开始日期" /><span>至</span><input v-model="toDate" type="date" aria-label="结束日期" /></label>
      </div>
      <div class="runs-toolbar-actions">
        <button v-if="hasFilters" class="icon-command" type="button" title="清除筛选" @click="clearFilters"><X :size="15" /></button>
        <button class="icon-command" type="button" title="刷新" @click="store.refreshAll"><RefreshCw :size="15" /></button>
      </div>
    </div>
    <div class="runs-layout">
      <aside class="run-list">
        <button v-for="run in filtered" :key="run.id" :class="{ active: store.currentRun?.id === run.id }" @click="store.selectRun(run.id)">
          <span :class="['status-dot', run.status]" /><div><strong>{{ summaryFor(run).title }}</strong><small>{{ summaryFor(run).summary }} · {{ new Date(run.updatedAt).toLocaleString() }}</small></div><b>{{ summaryFor(run).status }}</b>
        </button>
        <div v-if="!filtered.length" class="panel-empty">{{ hasFilters ? '没有符合当前条件的记录' : '暂无 Agent 记录' }}</div>
      </aside>
      <main class="run-detail">
        <template v-if="store.currentRun">
          <header data-tour="assistant-progress"><div><strong>{{ summaryFor(store.currentRun).title }}</strong><span>{{ summaryFor(store.currentRun).status }}</span></div><small>{{ summaryFor(store.currentRun).summary }}</small></header>
          <ApprovalCard v-if="store.pendingApproval" data-tour="assistant-approval" :approval="store.pendingApproval" :busy="store.running" @decide="decide" />
          <section
            v-if="store.currentRun.message || store.currentRun.response"
            class="agent-response"
            :data-tour="store.currentRun.status === 'completed' ? 'assistant-result' : undefined"
          >
            <div v-if="store.currentRun.message" class="run-exchange user">
              <div class="message-meta"><strong>你</strong></div>
              <p class="run-user-message">{{ store.currentRun.message }}</p>
            </div>
            <div v-if="store.currentRun.response" class="run-exchange assistant">
              <div class="message-meta"><strong>CppPilot</strong><span>{{ summaryFor(store.currentRun).status }}</span></div>
              <div class="message-markdown" v-html="renderMarkdown(store.currentRun.response)" />
            </div>
            <div v-else-if="active" class="run-exchange assistant">
              <div class="message-meta"><strong>CppPilot</strong><span>回答中</span></div>
              <p class="message-thinking">正在组织回答…</p>
            </div>
          </section>
          <p class="assistant-next-action"><strong>下一步：</strong>{{ summaryFor(store.currentRun).nextAction }}</p>
          <details class="assistant-technical-details" :open="timelineOpen"><summary>查看处理过程与技术细节</summary><RunTimeline :events="timeline" /><section v-if="toolCalls.length" class="tool-call-list"><header><strong>工具调用</strong><span>{{ toolCalls.length }}</span></header><article v-for="call in toolCalls" :key="call.id"><div><strong>{{ call.toolName }}</strong><small>{{ call.serverName }} · {{ call.risk }} · {{ call.status }}</small></div><code>{{ JSON.stringify(call.parameterSummary) }}</code><span>{{ call.result?.summary ?? call.errorCode ?? '执行中' }}</span><time>{{ call.durationMs ?? 0 }} ms</time></article></section></details>
        </template>
        <div v-else class="panel-empty">选择一条记录查看证据链</div>
      </main>
    </div>
    <section class="assistant-error-history">
      <header><div><strong>历史报错与解决过程</strong><span>从编译、运行和调试中保留的可追溯记录</span></div><span>{{ filteredErrors.length }} / {{ store.errors.length }} 条</span></header>
      <article v-for="entry in filteredErrors" :key="entry.id">
        <div><strong>{{ entry.title }}</strong><small>{{ entry.category }} · {{ new Date(entry.lastSeenAt).toLocaleString() }} · 出现 {{ entry.occurrences }} 次</small></div>
        <p>{{ entry.evidence }}</p><b>{{ entry.status === 'resolved' ? '已记录解决过程' : '建议在项目中继续处理' }}</b>
      </article>
      <div v-if="!filteredErrors.length" class="panel-empty">{{ hasFilters ? '没有符合当前条件的历史报错' : '暂无历史报错。助教处理编译、运行或逻辑问题后，相关过程会显示在这里。' }}</div>
    </section>
    <div class="runs-composer" data-tour="assistant-composer">
      <AgentComposer
        :busy="Boolean(active) || store.running"
        :cancellable="store.currentRun?.status === 'waiting-input'"
        :suggestion="showTourSuggestion ? agentTourSuggestion : undefined"
        @submit="submit"
        @cancel="store.currentRun && store.cancel(store.currentRun.id)"
      />
    </div>
  </div>
</template>
