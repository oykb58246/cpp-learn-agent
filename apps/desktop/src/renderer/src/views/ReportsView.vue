<script setup lang="ts">
import { onMounted } from 'vue'
import { Award, BarChart3, BookCheck, Bug, Clock3, Sparkles } from 'lucide-vue-next'
import { useAgentStore } from '../stores/agent'
const store = useAgentStore()
onMounted(() => store.refreshAll())
</script>

<template>
  <div class="h3-view">
    <section class="page-header"><div><p class="eyebrow">Verified Learning</p><h1>学习报告</h1><p>只统计具有工具或复习证据的学习事件。</p></div><BarChart3 :size="24" /></section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div><div v-else-if="store.loading" class="h3-state">正在聚合学习报告…</div>
    <div class="report-metrics">
      <article><Sparkles :size="18" /><strong>{{ store.summary?.xp ?? 0 }}</strong><span>XP · Lv.{{ store.summary?.level ?? 1 }}</span></article>
      <article><BookCheck :size="18" /><strong>{{ store.summary?.verifiedConcepts ?? 0 }}</strong><span>已验证知识</span></article>
      <article><Bug :size="18" /><strong>{{ store.summary?.openErrors ?? 0 }}</strong><span>待解决错误</span></article>
      <article><Clock3 :size="18" /><strong>{{ store.summary?.dueReviews ?? 0 }}</strong><span>到期复习</span></article>
    </div>
    <div class="report-layout">
      <section><header><Award :size="16" /><strong>勋章</strong><span>成长阶段 {{ store.summary?.growthStage ?? 1 }}/4</span></header>
        <div class="achievement-list"><article v-for="item in store.summary?.achievements" :key="item.achievementId"><Award :size="17" /><div><strong>{{ item.achievementId }}</strong><small>{{ new Date(item.unlockedAt).toLocaleDateString() }}</small></div></article><div v-if="!store.summary?.achievements.length" class="panel-empty">完成验证任务后解锁勋章</div></div>
      </section>
      <section><header><strong>最近学习事件</strong></header>
        <div class="learning-event-list"><article v-for="item in store.summary?.recentEvents" :key="item.id"><span>{{ item.type }}</span><strong>+{{ item.xp }} XP</strong><small>{{ item.evidence.summary }}</small></article><div v-if="!store.summary?.recentEvents.length" class="panel-empty">暂无已验证学习事件</div></div>
      </section>
    </div>
  </div>
</template>
