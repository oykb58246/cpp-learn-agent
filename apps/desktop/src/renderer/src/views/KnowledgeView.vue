<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { CheckCircle2, CircleDot, CircleGauge, Search, Sparkles, Zap } from 'lucide-vue-next'
import type { LearnerKnowledge } from '@cpp-pet/contracts'
import {
  buildKnowledgeLanes,
  categoryTone,
  filterKnowledgeLanes,
  type KnowledgePathNode,
  type KnowledgePathStatus
} from '../utils/knowledge-path'
import { ElMessage } from 'element-plus'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
const pendingConceptId = ref<string | null>(null)
const query = ref('')
const focusId = ref<string | null>(null)
const boardScrollEl = ref<HTMLElement | null>(null)
const activeLaneCategory = ref<string | null>(null)
const initialScrollDone = ref(false)

const statusCycle: Array<{ value: KnowledgePathStatus; persisted: LearnerKnowledge['status']; label: string; title: string }> = [
  { value: 'locked', persisted: 'locked', label: '未', title: '未学习' },
  { value: 'learning', persisted: 'learning', label: '学', title: '学习中' },
  { value: 'mastered', persisted: 'self-claimed', label: '通', title: '已掌握' }
]

const lanes = computed(() => buildKnowledgeLanes(store.catalog, store.knowledge))
const visibleLanes = computed(() => filterKnowledgeLanes(lanes.value, query.value))
const stateCount = computed(() => {
  const counts = { locked: 0, learning: 0, mastered: 0 } as Record<KnowledgePathStatus, number>
  for (const lane of lanes.value) {
    counts.locked += lane.locked
    counts.learning += lane.learning
    counts.mastered += lane.mastered
  }
  return counts
})

const titleById = computed(() => new Map(store.catalog.map(node => [node.id, node.title])))
const prerequisiteTitle = (id: string) => titleById.value.get(id) ?? id
const canSelect = (canAdvance: boolean, target: KnowledgePathStatus) => target === 'locked' || canAdvance
const iconFor = (status: KnowledgePathStatus) => status === 'mastered' ? CheckCircle2 : status === 'learning' ? CircleGauge : CircleDot
const statusLabel = (status: KnowledgePathStatus) => statusCycle.find(option => option.value === status)?.title ?? status
const stageToken = (stage: number) => String(stage).padStart(2, '0')

function laneWidthClass(lane: { rows: KnowledgePathNode[][] }) {
  const max = lane.rows.reduce((n, row) => Math.max(n, row.length), 1)
  if (max >= 3) return 'cols-3'
  if (max >= 2) return 'cols-2'
  return 'cols-1'
}

function isLaneComplete(lane: { total: number; mastered: number }) {
  return lane.total > 0 && lane.mastered >= lane.total
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return String(value)
}

function scrollToFirstIncompleteLane() {
  const root = boardScrollEl.value
  if (!root || !visibleLanes.value.length) return
  const incompleteIndex = visibleLanes.value.findIndex(lane => !isLaneComplete(lane))
  // ??????,??????????:?????,????????
  if (incompleteIndex <= 0) {
    root.scrollLeft = 0
    return
  }
  const incomplete = visibleLanes.value[incompleteIndex]
  if (!incomplete) {
    root.scrollLeft = 0
    return
  }
  const el = root.querySelector<HTMLElement>(`[data-lane-category="${cssEscape(incomplete.category)}"]`)
  if (!el) {
    root.scrollLeft = 0
    return
  }
  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const nextLeft = root.scrollLeft + (elRect.left - rootRect.left) - 8
  root.scrollLeft = Math.max(0, Math.min(nextLeft, root.scrollWidth - root.clientWidth))
}

async function scheduleInitialScroll() {
  if (initialScrollDone.value || !visibleLanes.value.length) return
  await nextTick()
  scrollToFirstIncompleteLane()
  requestAnimationFrame(() => {
    scrollToFirstIncompleteLane()
    initialScrollDone.value = true
  })
}

function isRelated(entry: KnowledgePathNode): boolean {
  if (!focusId.value) return false
  if (entry.node.id === focusId.value) return true
  if (entry.node.prerequisites.includes(focusId.value)) return true
  const focused = store.catalog.find(node => node.id === focusId.value)
  return Boolean(focused?.prerequisites.includes(entry.node.id))
}

function isDimmed(entry: KnowledgePathNode): boolean {
  return Boolean(focusId.value) && !isRelated(entry)
}

function activateLane(category: string) {
  activeLaneCategory.value = category
}

function clearLaneScrollMode() {
  activeLaneCategory.value = null
}

function onBoardPointerDown(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  // 点到看板空白/非阶段区域时恢复横向滚轮
  if (target.closest('.knowledge-stage')) return
  clearLaneScrollMode()
}

function onBoardWheel(event: WheelEvent) {
  const root = boardScrollEl.value
  if (!root) return

  // 阶段纵向模式：滚轮上下滚动该阶段内容
  if (activeLaneCategory.value) {
    const stage = root.querySelector<HTMLElement>(`[data-lane-category="${cssEscape(activeLaneCategory.value)}"]`)
    const body = stage?.querySelector<HTMLElement>('.knowledge-stage-body')
    if (body) {
      const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX) && !event.shiftKey
      if (vertical) {
        event.preventDefault()
        body.scrollTop += event.deltaY
        return
      }
    }
  }

  // 默认横向：纵向滚轮映射为左右切换阶段
  if (root.scrollWidth <= root.clientWidth + 2) return
  event.preventDefault()
  root.scrollLeft += event.deltaY || event.deltaX
}

function nextStatus(current: KnowledgePathStatus): typeof statusCycle[number] | null {
  const index = statusCycle.findIndex(item => item.value === current)
  // 只在允许的状态中循环：未完成前置时不能进入学习中/已掌握
  for (let step = 1; step <= statusCycle.length; step += 1) {
    const candidate = statusCycle[(index + step) % statusCycle.length]
    if (!candidate) continue
    // 这里 canAdvance 在调用处再判断
    return candidate
  }
  return null
}

const setStatus = async (conceptId: string, status: LearnerKnowledge['status'], unlockPath = false) => {
  pendingConceptId.value = conceptId
  try {
    await store.updateKnowledge(conceptId, status, unlockPath ? { unlockPath: true } : undefined)
  } finally {
    pendingConceptId.value = null
  }
}

function notifyBlocked(entry: KnowledgePathNode) {
  const missing = entry.missingPrerequisiteIds.map(prerequisiteTitle).filter(Boolean)
  const detail = missing.length
    ? `请先完成前置：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}，或点右侧闪电图标「点亮到此」。`
    : '前置尚未完成，无法切换到学习中/已掌握。可点右侧闪电图标一键点亮。'
  ElMessage.warning({
    message: detail,
    duration: 3200,
    showClose: true
  })
}

async function cycleStatus(entry: KnowledgePathNode) {
  if (pendingConceptId.value) return
  if (!entry.canAdvance && entry.status === 'locked') {
    notifyBlocked(entry)
    return
  }
  const index = statusCycle.findIndex(item => item.value === entry.status)
  for (let step = 1; step <= statusCycle.length; step += 1) {
    const next = statusCycle[(index + step) % statusCycle.length]
    if (!next) continue
    if (!canSelect(entry.canAdvance, next.value)) continue
    if (next.value === entry.status) continue
    await setStatus(entry.node.id, next.persisted, false)
    return
  }
  if (!entry.canAdvance) notifyBlocked(entry)
}

async function unlockToHere(entry: KnowledgePathNode) {
  if (pendingConceptId.value) return
  const target = entry.status === 'learning' ? 'learning' : 'self-claimed'
  await setStatus(entry.node.id, target, true)
}

onMounted(async () => {
  await store.refreshAll()
  await scheduleInitialScroll()
})

watch(visibleLanes, async () => {
  if (!initialScrollDone.value) await scheduleInitialScroll()
})
</script>



<template>
  <div class="h3-view knowledge-view knowledge-constellation" @pointerdown="clearLaneScrollMode">
    <section class="page-header page-header-plain knowledge-view-header">
      <div>
        <p class="eyebrow">Learning Path</p>
        <h1>知识树</h1>
        <p>默认滚轮左右切换阶段；点击阶段后滚轮改为上下。状态环受前置约束，跨前置请点闪电点亮。</p>
      </div>
    </section>

    <div v-if="store.error && !store.catalog.length" class="h3-state error">{{ store.error.message }}</div>
    <div v-else-if="store.loading && !store.catalog.length" class="h3-state">正在加载知识树…</div>

    <template v-else>
      <div v-if="store.error" class="h3-state error">{{ store.error.message }}</div>

      <div class="knowledge-topbar">
        <div class="knowledge-summary knowledge-orbit-summary">
          <span class="orbit-stat locked"><i />未学习 {{ stateCount.locked }}</span>
          <span class="orbit-stat learning"><i />学习中 {{ stateCount.learning }}</span>
          <span class="orbit-stat mastered"><i />已掌握 {{ stateCount.mastered }}</span>
        </div>
        <div class="knowledge-search">
          <Search :size="15" />
          <input v-model="query" type="search" placeholder="搜索知识点 / 主题" />
        </div>
        <div class="status-legend" aria-label="状态环说明">
          <span class="legend-item">
            <button type="button" class="legend-ring locked" tabindex="-1" aria-hidden="true"><CircleDot :size="13" /></button>
            未学习
          </span>
          <span class="legend-item">
            <button type="button" class="legend-ring learning" tabindex="-1" aria-hidden="true"><CircleGauge :size="13" /></button>
            学习中
          </span>
          <span class="legend-item">
            <button type="button" class="legend-ring mastered" tabindex="-1" aria-hidden="true"><CheckCircle2 :size="13" /></button>
            已掌握
          </span>
          <span class="legend-item legend-tip"><Sparkles :size="13" />默认左右浏览 · 点击阶段后可上下滚动</span>
          <span class="legend-item legend-tip"><Zap :size="13" />前置未完成时点闪电图标可一键点亮</span>
        </div>
      </div>

      <div v-if="visibleLanes.length" ref="boardScrollEl" class="knowledge-board-scroll" :class="{ 'lane-vertical': Boolean(activeLaneCategory) }" @wheel="onBoardWheel" @pointerdown="onBoardPointerDown">
        <div class="knowledge-board" role="list">
          <section
            v-for="lane in visibleLanes"
            :key="lane.category"
            class="knowledge-stage"
            :class="[categoryTone(lane.category), laneWidthClass(lane), { complete: isLaneComplete(lane), active: activeLaneCategory === lane.category }]"
            :data-lane-category="lane.category"
            role="listitem"
            @pointerdown.stop="activateLane(lane.category)"
          >
            <header class="knowledge-stage-header">
              <div class="stage-kicker">
                <span>阶段 {{ stageToken(lane.stage) }}</span>
                <b>{{ lane.total }}</b>
              </div>
              <strong>{{ lane.label }}</strong>
              <div class="stage-meter" aria-hidden="true">
                <i :style="{ width: `${lane.total ? Math.round((lane.mastered / lane.total) * 100) : 0}%` }" />
              </div>
            </header>

            <div class="knowledge-stage-body">
              <template v-for="(row, rowIndex) in lane.rows" :key="`${lane.category}-${rowIndex}`">
                <div v-if="rowIndex > 0" class="knowledge-flow-link" aria-hidden="true">
                  <span class="flow-line" />
                  <span class="flow-arrow" />
                </div>
                <!-- 同层多节点纵向排列，避免窄列双排穿模 -->
                <div class="knowledge-tier" :class="{ multi: row.length > 1 }">
                  <article
                    v-for="entry in row"
                    :key="entry.node.id"
                    class="knowledge-node"
                    :class="[
                      `status-${entry.status}`,
                      {
                        blocked: !entry.canAdvance,
                        focused: focusId === entry.node.id,
                        related: isRelated(entry),
                        dimmed: isDimmed(entry),
                        busy: pendingConceptId === entry.node.id
                      }
                    ]"
                    :data-concept-id="entry.node.id"
                    @click="focusId = focusId === entry.node.id ? null : entry.node.id"
                  >
                    <i class="node-status-bar" aria-hidden="true" />
                    <header>
                      <button
                        type="button"
                        class="node-status-toggle"
                        :title="entry.canAdvance ? `当前：${statusLabel(entry.status)} · 点击切换` : `当前：${statusLabel(entry.status)} · 请先点亮前置，或点右侧闪电`"
                        :disabled="pendingConceptId === entry.node.id"
                        :aria-label="`${entry.node.title} 切换掌握状态，当前${statusLabel(entry.status)}`"
                        @click.stop="cycleStatus(entry)"
                      >
                        <component :is="iconFor(entry.status)" :size="14" />
                      </button>
                      <div class="node-title-wrap">
                        <strong>{{ entry.node.title }}</strong>
                        <em class="node-status-chip">{{ statusLabel(entry.status) }}</em>
                      </div>
                      <button
                        type="button"
                        class="node-unlock-icon"
                        :disabled="pendingConceptId === entry.node.id || (entry.status === 'mastered' && entry.canAdvance)"
                        :title="entry.canAdvance && entry.status === 'mastered' ? '已掌握' : '一键补齐前置并点亮到此'"
                        :aria-label="`点亮到${entry.node.title}`"
                        @click.stop="unlockToHere(entry)"
                      >
                        <Zap :size="13" />
                      </button>
                    </header>

                    <p v-if="entry.node.prerequisites.length" class="knowledge-prerequisites">
                      <span
                        v-for="id in entry.node.prerequisites"
                        :key="id"
                        :class="{ missing: entry.missingPrerequisiteIds.includes(id) }"
                      >{{ prerequisiteTitle(id) }}</span>
                    </p>
                  </article>
                </div>
              </template>
            </div>
          </section>
        </div>
      </div>
      <div v-else class="panel-empty h3-empty">没有匹配的知识点</div>
    </template>
  </div>
</template>