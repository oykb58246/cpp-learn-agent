<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpen, CircleDotDashed, Pencil, Sparkles } from 'lucide-vue-next'
import BackgroundProfileDialog from '../components/BackgroundProfileDialog.vue'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
const profileDialogVisible = ref(false)
onMounted(async () => {
  await Promise.all([store.refreshAll(), store.loadBackground()])
})

const categories = computed(() => [...new Set(store.catalog.map(item => item.category))])
const studied = computed(() => new Set(store.background?.studiedConceptIds ?? []))
const focus = computed(() => new Set(store.background?.focusConceptIds ?? []))
const statusOf = (id: string) => studied.value.has(id) ? '学过' : '尚未接触'
const unseenCount = computed(() => store.catalog.filter(node => !studied.value.has(node.id)).length)
</script>

<template>
  <div class="h3-view">
    <section class="page-header">
      <div><p class="eyebrow">Assistant Context</p><h1>知识树</h1><p>告诉助教你学过什么、哪些希望讲得更细。它只影响解释方式，不用于判断你的掌握程度。</p></div>
      <button class="secondary-command" @click="profileDialogVisible = true"><Pencil :size="15" />编辑背景</button>
    </section>
    <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div><div v-else-if="store.loading" class="h3-state">正在加载知识树…</div>
    <div class="knowledge-summary"><span>已标注学过 {{ studied.size }}</span><span>希望重点解释 {{ focus.size }}</span><span>尚未接触 {{ unseenCount }}</span></div>
    <div class="knowledge-groups assistant-knowledge-groups">
      <section v-for="category in categories" :key="category">
        <header><strong>{{ category }}</strong><span>{{ store.catalog.filter(item => item.category === category).length }} 个知识点</span></header>
        <article v-for="node in store.catalog.filter(item => item.category === category)" :key="node.id" :class="{ studied: studied.has(node.id), focus: focus.has(node.id) }">
          <BookOpen v-if="studied.has(node.id)" :size="16" /><CircleDotDashed v-else :size="16" />
          <div><strong>{{ node.title }}</strong><small>{{ node.prerequisites.length ? `前置：${node.prerequisites.join('、')}` : '基础概念' }}</small></div>
          <div class="knowledge-tags"><b>{{ statusOf(node.id) }}</b><b v-if="focus.has(node.id)" class="focus-tag"><Sparkles :size="11" />重点解释</b></div>
        </article>
      </section>
    </div>
    <div v-if="!store.loading && !store.catalog.length" class="panel-empty h3-empty">暂无知识节点</div>
    <BackgroundProfileDialog v-model="profileDialogVisible" @saved="store.loadBackground()" />
  </div>
</template>
