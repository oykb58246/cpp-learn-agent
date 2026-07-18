<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, CircleDotDashed, CircleGauge } from 'lucide-vue-next'
import type { LearnerKnowledge } from '@cpp-pet/contracts'
import { buildKnowledgeLanes, type KnowledgePathStatus } from '../utils/knowledge-path'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
const pendingConceptId = ref<string | null>(null)

const statusOptions: Array<{ value: KnowledgePathStatus; persisted: LearnerKnowledge['status']; label: string }> = [
  { value: 'locked', persisted: 'locked', label: '未学习' },
  { value: 'learning', persisted: 'learning', label: '学习中' },
  { value: 'mastered', persisted: 'self-claimed', label: '已掌握' }
]

onMounted(() => store.refreshAll())

const lanes = computed(() => buildKnowledgeLanes(store.catalog, store.knowledge))
const entries = computed(() => lanes.value.flatMap(lane => lane.rows.flat()))
const stateCount = computed(() => entries.value.reduce((counts, entry) => {
  counts[entry.status] += 1
  return counts
}, { locked: 0, learning: 0, mastered: 0 } as Record<KnowledgePathStatus, number>))

const prerequisiteTitle = (id: string) => store.catalog.find(node => node.id === id)?.title ?? id
const canSelect = (canAdvance: boolean, target: KnowledgePathStatus) => target === 'locked' || canAdvance
const iconFor = (status: KnowledgePathStatus) => status === 'mastered' ? CheckCircle2 : status === 'learning' ? CircleGauge : CircleDotDashed

const setStatus = async (conceptId: string, status: LearnerKnowledge['status']) => {
  pendingConceptId.value = conceptId
  try {
    await store.updateKnowledge(conceptId, status)
  } finally {
    pendingConceptId.value = null
  }
}
</script>

<template>
  <div class="h3-view">
    <section class="page-header">
      <div>
        <p class="eyebrow">Learning Path</p>
        <h1>知识树</h1>
        <p>沿着前置关系推进学习；同一层级的知识点可以并行掌握。</p>
      </div>
    </section>

    <div v-if="store.error && !store.catalog.length" class="h3-state error">{{ store.error.message }}</div>
    <div v-else-if="store.loading && !store.catalog.length" class="h3-state">正在加载知识树…</div>

    <template v-else>
      <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div>
      <div class="knowledge-summary">
        <span>未学习 {{ stateCount.locked }}</span>
        <span>学习中 {{ stateCount.learning }}</span>
        <span>已掌握 {{ stateCount.mastered }}</span>
      </div>

      <div v-if="lanes.length" class="knowledge-path-scroll">
        <div class="knowledge-path">
          <section v-for="(lane, laneIndex) in lanes" :key="lane.category" class="knowledge-path-lane">
            <header class="knowledge-path-lane-header">
              <div><span>阶段 {{ String(laneIndex + 1).padStart(2, '0') }}</span><strong>{{ lane.category }}</strong></div>
              <b>{{ lane.rows.flat().length }} 个知识点</b>
            </header>

            <div v-for="(row, rowIndex) in lane.rows" :key="rowIndex" class="knowledge-path-row">
              <article
                v-for="entry in row"
                :key="entry.node.id"
                class="knowledge-path-node"
                :class="[`status-${entry.status}`, { blocked: !entry.canAdvance }]"
                :data-concept-id="entry.node.id"
              >
                <header>
                  <component :is="iconFor(entry.status)" :size="16" />
                  <div>
                    <strong>{{ entry.node.title }}</strong>
                    <small>{{ entry.node.description }}</small>
                  </div>
                  <b>{{ statusOptions.find(option => option.value === entry.status)?.label }}</b>
                </header>

                <p v-if="entry.node.prerequisites.length" class="knowledge-prerequisites">
                  前置：
                  <span
                    v-for="id in entry.node.prerequisites"
                    :key="id"
                    :class="{ missing: entry.missingPrerequisiteIds.includes(id) }"
                  >{{ prerequisiteTitle(id) }}</span>
                </p>

                <div class="knowledge-status-control" role="group" :aria-label="`${entry.node.title} 掌握状态`">
                  <button
                    v-for="option in statusOptions"
                    :key="option.value"
                    type="button"
                    :class="{ selected: entry.status === option.value }"
                    :disabled="pendingConceptId === entry.node.id || entry.status === option.value || !canSelect(entry.canAdvance, option.value)"
                    :aria-pressed="entry.status === option.value"
                    :aria-label="`${entry.node.title} ${option.label}`"
                    @click="setStatus(entry.node.id, option.persisted)"
                  >{{ option.label }}</button>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>

      <div v-else class="panel-empty h3-empty">暂无知识节点</div>
    </template>
  </div>
</template>

