<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, LoaderCircle, X } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useAgentStore } from '../stores/agent'
import { useProductTourStore } from '../stores/product-tour'
import { useWorkspaceStore } from '../stores/workspace'
import { beginnerTourSteps, panelPlacement, productTourTarget, type ProductTourAgentPhase, type RectLike } from '../utils/product-tour'

const props = withDefaults(defineProps<{ blocked?: boolean }>(), { blocked: false })
const route = useRoute()
const router = useRouter()
const agent = useAgentStore()
const tour = useProductTourStore()
const workspace = useWorkspaceStore()
const panelEl = ref<HTMLElement | null>(null)
const headingEl = ref<HTMLElement | null>(null)
const targetRect = ref<RectLike | null>(null)
const targetFound = ref(false)
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const panelSize = ref({ width: 380, height: 280 })
let locateGeneration = 0
let restoreFocus: HTMLElement | null = null

const step = computed(() => beginnerTourSteps[tour.currentStepIndex] ?? beginnerTourSteps[0]!)
const trackedRun = computed(() => agent.currentRun?.id === tour.agentRunId ? agent.currentRun : null)
const agentReady = computed(() => trackedRun.value?.status === 'completed' && Boolean(trackedRun.value.response))
const agentFailed = computed(() => trackedRun.value?.status === 'failed' || trackedRun.value?.status === 'cancelled')
const agentBusy = computed(() => Boolean(trackedRun.value && !['completed', 'failed', 'cancelled'].includes(trackedRun.value.status)))
const approvalPending = computed(() => Boolean(trackedRun.value?.pendingApproval))
const agentPhase = computed<ProductTourAgentPhase>(() => {
  if (approvalPending.value) return 'approval'
  if (agentReady.value) return 'ready'
  if (agentFailed.value) return 'failed'
  if (agentBusy.value) return 'running'
  return 'idle'
})
const targetSelector = computed(() => productTourTarget(step.value, agentPhase.value))
const placement = computed(() => panelPlacement(targetRect.value, viewport.value, panelSize.value))
const panelStyle = computed(() => ({ left: `${placement.value.left}px`, top: `${placement.value.top}px` }))
const focusStyle = computed(() => {
  if (!targetRect.value) return undefined
  const pad = 6
  return {
    left: `${Math.max(0, targetRect.value.left - pad)}px`,
    top: `${Math.max(0, targetRect.value.top - pad)}px`,
    width: `${Math.min(viewport.value.width, targetRect.value.right + pad) - Math.max(0, targetRect.value.left - pad)}px`,
    height: `${Math.min(viewport.value.height, targetRect.value.bottom + pad) - Math.max(0, targetRect.value.top - pad)}px`
  }
})
const maskStyles = computed(() => {
  const rect = targetRect.value
  if (!rect) return []
  const pad = 6
  const top = Math.max(0, rect.top - pad)
  const left = Math.max(0, rect.left - pad)
  const right = Math.min(viewport.value.width, rect.right + pad)
  const bottom = Math.min(viewport.value.height, rect.bottom + pad)
  return [
    { left: '0', top: '0', width: '100vw', height: `${top}px` },
    { left: '0', top: `${top}px`, width: `${left}px`, height: `${Math.max(0, bottom - top)}px` },
    { left: `${right}px`, top: `${top}px`, width: `${Math.max(0, viewport.value.width - right)}px`, height: `${Math.max(0, bottom - top)}px` },
    { left: '0', top: `${bottom}px`, width: '100vw', height: `${Math.max(0, viewport.value.height - bottom)}px` }
  ]
})
const body = computed(() => {
  if (step.value.id === 'workspace-agent' && !workspace.projects.length) {
    return '你还没有项目。回到首页创建或导入项目后，打开一个 C++ 文件，就能在工具栏打开 Agent 并结合代码提问。'
  }
  if (step.value.id === 'assistant-input' && agentFailed.value) {
    return '这次助教任务没有完成。你可以保留当前页面重试，也可以先跳到工作区继续了解。'
  }
  if (step.value.id === 'assistant-input' && approvalPending.value) {
    return '助教需要发送或执行受保护的操作。请先检查审批内容，再选择批准或拒绝；你的决定会被记录。'
  }
  if (step.value.id === 'assistant-input' && agentBusy.value) {
    return '操作已获批准，助教正在继续处理。回答完成后会自动进入下一步。'
  }
  return step.value.body
})
const primaryLabel = computed(() => ({
  welcome: '下一步',
  navigation: '去问助教',
  'assistant-input': agentFailed.value ? '跳过，看看工作区' : '查看回答',
  'assistant-result': '下一步：代码工作区',
  'workspace-agent': '完成体验',
  complete: '返回首页'
}[step.value.id]))
const primaryDisabled = computed(() => step.value.id === 'assistant-input' && !agentReady.value && !agentFailed.value)
const statusText = computed(() => {
  if (step.value.id !== 'assistant-input') return ''
  if (!tour.agentRunId) return '先选择示例问题，确认后点击发送。'
  if (approvalPending.value) return '这一步需要你的确认，请在高亮区域选择批准或拒绝。'
  if (agentBusy.value) return '助教正在阅读问题并组织解释。'
  if (agentReady.value) return '回答已完成，可以继续查看结果。'
  if (agentFailed.value) return '任务未完成，可以重试或跳过这一步。'
  return '正在等待助教状态。'
})

function routeMatches(path: string) {
  return path === '/workspace' ? route.path.startsWith('/workspace') : route.path === path
}

async function locateTarget() {
  const generation = ++locateGeneration
  const current = step.value
  tour.locating = true
  targetRect.value = null
  targetFound.value = false

  if (current.route && !routeMatches(current.route)) await router.push(current.route)
  await nextTick()

  let target: HTMLElement | null = null
  const selector = targetSelector.value
  if (selector) {
    const deadline = performance.now() + 2_000
    while (generation === locateGeneration && performance.now() < deadline) {
      target = document.querySelector<HTMLElement>(selector)
      if (target && target.getBoundingClientRect().width > 0 && target.getBoundingClientRect().height > 0) break
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  if (generation !== locateGeneration) return

  if (target) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    await nextTick()
    const rect = target.getBoundingClientRect()
    targetRect.value = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    }
    targetFound.value = true
  }
  tour.locating = false
  await nextTick()
  measurePanel()
  headingEl.value?.focus({ preventScroll: true })
}

function measurePanel() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  if (!panelEl.value) return
  const rect = panelEl.value.getBoundingClientRect()
  panelSize.value = { width: rect.width || 380, height: rect.height || 280 }
}

function handleResize() {
  measurePanel()
  if (targetFound.value) void locateTarget()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !tour.open) return
  event.preventDefault()
  pause()
}

function pause() {
  tour.pause()
  restoreFocus?.focus({ preventScroll: true })
}

async function exitTour() {
  if (tour.replaying) pause()
  else await tour.dismiss()
}

async function previous() {
  if (tour.currentStepIndex > 0) await tour.goTo(tour.currentStepIndex - 1)
}

async function next() {
  if (primaryDisabled.value) return
  if (step.value.id === 'assistant-input' && agentFailed.value) {
    await tour.goTo(4)
    return
  }
  if (step.value.id === 'complete') {
    await tour.complete()
    await router.push('/home')
    return
  }
  await tour.goTo(tour.currentStepIndex + 1)
}

async function finishHere() {
  await tour.complete()
}

watch(
  () => [tour.open, tour.currentStepIndex, props.blocked] as const,
  ([open]) => {
    if (!open || props.blocked) {
      locateGeneration++
      targetRect.value = null
      return
    }
    restoreFocus ??= document.activeElement instanceof HTMLElement ? document.activeElement : null
    void locateTarget()
  },
  { immediate: true }
)
watch(() => route.fullPath, () => {
  if (tour.open && !props.blocked) void locateTarget()
})
watch(() => `${trackedRun.value?.status ?? ''}:${trackedRun.value?.response ?? ''}:${trackedRun.value?.pendingApproval?.id ?? ''}`, () => {
  if (tour.open && step.value.id === 'assistant-input') void locateTarget()
})
watch(agentReady, (ready) => {
  if (ready && tour.open && step.value.id === 'assistant-input') void tour.goTo(tour.currentStepIndex + 1)
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  locateGeneration++
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div v-if="tour.open && !blocked" class="product-tour-layer">
    <div v-if="!targetRect" key="full-mask" class="product-tour-mask-piece product-tour-mask-full" />
    <template v-else>
      <div v-for="(style, index) in maskStyles" :key="`target-mask-${index}`" class="product-tour-mask-piece" :style="style" />
    </template>
    <div v-if="focusStyle" class="product-tour-focus" :class="{ interactive: step.interactive }" :style="focusStyle" />
    <section
      ref="panelEl"
      class="product-tour-panel"
      :class="{ centered: placement.centered }"
      :style="panelStyle"
      role="dialog"
      :aria-labelledby="`product-tour-title-${step.id}`"
    >
      <header>
        <span>{{ tour.currentStepIndex + 1 }} / {{ beginnerTourSteps.length }}</span>
        <button class="icon-command" type="button" title="关闭引导" aria-label="关闭引导" @click="pause"><X :size="15" /></button>
      </header>
      <div class="product-tour-copy">
        <span class="product-tour-step-icon">
          <CheckCircle2 v-if="step.id === 'complete'" :size="20" />
          <LoaderCircle v-else-if="tour.locating" :size="20" class="spinning" />
          <CircleHelp v-else :size="20" />
        </span>
        <div>
          <h2 :id="`product-tour-title-${step.id}`" ref="headingEl" tabindex="-1">{{ step.title }}</h2>
          <p>{{ body }}</p>
        </div>
      </div>
      <p v-if="tour.locating" class="product-tour-status" aria-live="polite">正在定位页面中的操作位置…</p>
      <p v-else-if="targetSelector && !targetFound" class="product-tour-status" aria-live="polite">当前页面没有找到对应位置，你仍可继续下一步或稍后重试。</p>
      <p v-if="statusText" class="product-tour-status" aria-live="polite">{{ statusText }}</p>
      <footer>
        <button v-if="step.id === 'complete'" class="secondary-command" type="button" @click="finishHere">留在当前页</button>
        <button v-else-if="tour.currentStepIndex > 0" class="secondary-command" type="button" @click="previous"><ArrowLeft :size="14" />返回</button>
        <button class="text-command" type="button" @click="pause">稍后继续</button>
        <button v-if="step.id !== 'complete'" class="text-command" type="button" @click="exitTour">{{ tour.replaying ? '退出重看' : '结束引导' }}</button>
        <button class="primary-command" type="button" :disabled="primaryDisabled" @click="next">
          {{ primaryLabel }}<ArrowRight v-if="step.id !== 'complete'" :size="14" />
        </button>
      </footer>
    </section>
  </div>
</template>
