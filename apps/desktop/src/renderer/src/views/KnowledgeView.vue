<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { BookOpen, CheckCircle2, Circle, CircleDot, LockKeyhole } from 'lucide-vue-next'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
onMounted(() => store.refreshAll())
const stateById = computed(() => new Map(store.knowledge.map(item => [item.conceptId, item])))
const categories = computed(() => [...new Set(store.catalog.map(item => item.category))])
const activeStatuses = new Set(['learning', 'self-claimed', 'verified', 'review'])
const statusOf = (id: string) => {
  const current = stateById.value.get(id)?.status
  if (current) return current
  const node = store.catalog.find(item => item.id === id)
  return node?.prerequisites.every(prerequisite => activeStatuses.has(stateById.value.get(prerequisite)?.status ?? 'locked')) ? 'available' : 'locked'
}
const iconOf = (id: string) => statusOf(id) === 'verified' ? CheckCircle2 : statusOf(id) === 'learning' ? CircleDot : statusOf(id) === 'available' ? Circle : LockKeyhole
</script>

<template>
  <div class="h3-view">
    <section class="page-header"><div><p class="eyebrow">Knowledge Gate</p><h1>知识树</h1><p>知识状态直接约束 Agent 可以使用的概念。</p></div><BookOpen :size="24" /></section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div><div v-else-if="store.loading" class="h3-state">正在加载知识树…</div>
    <div class="knowledge-summary"><span>节点 {{ store.catalog.length }}</span><span>已验证 {{ store.summary?.verifiedConcepts ?? 0 }}</span><span>学习中 {{ store.summary?.learningConcepts ?? 0 }}</span></div>
    <div class="knowledge-groups">
      <section v-for="category in categories" :key="category">
        <header><strong>{{ category }}</strong><span>{{ store.catalog.filter(item => item.category === category).length }}</span></header>
        <article v-for="node in store.catalog.filter(item => item.category === category)" :key="node.id" :class="statusOf(node.id)">
          <component :is="iconOf(node.id)" :size="16" /><div><strong>{{ node.title }}</strong><small>{{ node.prerequisites.length ? `前置：${node.prerequisites.join('、')}` : '起始节点' }}</small></div><b>{{ statusOf(node.id) }}</b>
          <button v-if="statusOf(node.id) === 'available'" class="secondary-command" @click="store.updateKnowledge(node.id, 'learning')">开始</button>
          <button v-else-if="statusOf(node.id) === 'learning'" class="secondary-command" @click="store.updateKnowledge(node.id, 'self-claimed')">已学习</button>
        </article>
      </section>
    </div>
    <div v-if="!store.loading && !store.catalog.length" class="panel-empty h3-empty">暂无知识节点</div>
  </div>
</template>
