<script setup lang="ts">
import { onMounted } from 'vue'
import { GraduationCap, Play, RefreshCw } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
const router = useRouter()
onMounted(() => store.refreshAll())
async function review(message: string, reviewItemId: string, reviewOutcome: 'passed' | 'failed') {
  const run = await store.start({ source: 'main', mode: 'review', message, reviewItemId, reviewOutcome })
  if (run) await router.push('/runs')
}
const reviewForError = (errorBookEntryId: string) => store.reviews.find(item => item.errorBookEntryId === errorBookEntryId)
</script>

<template>
  <div class="h3-view">
    <section class="page-header"><div><p class="eyebrow">Review Queue</p><h1>练习中心</h1><p>从真实错误证据生成到期复习。</p></div><GraduationCap :size="24" /></section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div><div v-else-if="store.loading" class="h3-state">正在加载复习队列…</div>
    <div class="practice-layout">
      <section><header><strong>到期复习</strong><span>{{ store.dueReviews.length }}</span></header>
        <article v-for="item in store.dueReviews" :key="item.id"><div><strong>{{ item.prompt }}</strong><small>{{ item.conceptId }} · {{ new Date(item.dueAt).toLocaleDateString() }}</small></div><div class="review-actions"><button class="secondary-command" @click="review(item.prompt, item.id, 'failed')"><RefreshCw :size="14" />需巩固</button><button class="primary-command" @click="review(item.prompt, item.id, 'passed')"><Play :size="14" />通过</button></div></article>
        <div v-if="!store.dueReviews.length" class="panel-empty">当前没有到期复习</div>
      </section>
      <section><header><strong>错误本</strong><span>{{ store.errors.length }}</span></header>
        <article v-for="item in store.errors" :key="item.id"><div><strong>{{ item.title }}</strong><small>{{ item.category }} · 出现 {{ item.occurrences }} 次</small><p>{{ item.evidence }}</p></div><button class="secondary-command" :disabled="!reviewForError(item.id)" @click="reviewForError(item.id) && review(`复习：${item.title}`, reviewForError(item.id)!.id, 'passed')"><Play :size="14" />验证通过</button></article>
        <div v-if="!store.errors.length" class="panel-empty">尚无错误记录</div>
      </section>
    </div>
  </div>
</template>
