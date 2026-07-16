<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bot, Filter, RefreshCw } from 'lucide-vue-next'
import type { AgentStartRequest } from '@cpp-pet/contracts'
import { useAgentStore } from '../stores/agent'
import AgentComposer from '../components/AgentComposer.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import RunTimeline from '../components/RunTimeline.vue'

const store = useAgentStore()
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

onMounted(async () => {
  store.subscribe()
  await store.refreshAll()
  if (!store.currentRun && store.runs[0]) await store.selectRun(store.runs[0].id)
})
onBeforeUnmount(() => store.dispose())

async function submit(request: AgentStartRequest) { await store.start(request) }
async function decide(decision: 'approved' | 'rejected') {
  if (store.pendingApproval) await store.decide(store.pendingApproval.id, decision)
}
</script>

<template>
  <div class="h3-view runs-view">
    <section class="page-header"><div><p class="eyebrow">Agent Runtime</p><h1>Agent 记录</h1><p>意图、上下文、计划、审批、工具证据与验证结论。</p></div><Bot :size="24" /></section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div>
    <div v-else-if="store.loading" class="h3-state">正在加载 Agent 记录…</div>
    <div class="runs-toolbar">
      <label><Filter :size="14" /><select v-model="status"><option value="all">全部状态</option><option value="waiting-approval">等待审批</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
      <button class="icon-command" title="刷新" @click="store.refreshAll"><RefreshCw :size="15" /></button>
    </div>
    <div class="runs-layout">
      <aside class="run-list">
        <button v-for="run in filtered" :key="run.id" :class="{ active: store.currentRun?.id === run.id }" @click="store.selectRun(run.id)">
          <span :class="['status-dot', run.status]" /><div><strong>{{ run.intent || run.message }}</strong><small>{{ run.mode }} · {{ new Date(run.updatedAt).toLocaleString() }}</small></div><b>{{ run.status }}</b>
        </button>
        <div v-if="!filtered.length" class="panel-empty">暂无 Agent 记录</div>
      </aside>
      <main class="run-detail">
        <template v-if="store.currentRun">
          <header><div><strong>{{ store.currentRun.intent || store.currentRun.message }}</strong><span>{{ store.currentRun.status }}</span></div><small>{{ store.currentRun.planSummary }}</small></header>
          <ApprovalCard v-if="store.pendingApproval" :approval="store.pendingApproval" :busy="store.running" @decide="decide" />
          <RunTimeline :events="timeline" />
          <section v-if="toolCalls.length" class="tool-call-list">
            <header><strong>工具调用</strong><span>{{ toolCalls.length }}</span></header>
            <article v-for="call in toolCalls" :key="call.id">
              <div><strong>{{ call.toolName }}</strong><small>{{ call.serverName }} · {{ call.risk }} · {{ call.status }}</small></div>
              <code>{{ JSON.stringify(call.parameterSummary) }}</code>
              <span>{{ call.result?.summary ?? call.errorCode ?? '执行中' }}</span>
              <time>{{ call.durationMs ?? 0 }} ms</time>
            </article>
          </section>
          <section v-if="store.currentRun.response" class="agent-response"><strong>回答</strong><p>{{ store.currentRun.response }}</p></section>
        </template>
        <div v-else class="panel-empty">选择一条记录查看证据链</div>
      </main>
    </div>
    <AgentComposer :busy="Boolean(active) || store.running" @submit="submit" @cancel="store.currentRun && store.cancel(store.currentRun.id)" />
  </div>
</template>
