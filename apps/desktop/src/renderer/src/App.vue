<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, ChevronsLeft, ChevronsRight, CircleHelp, Code2, Dumbbell, Home, Settings, Workflow } from 'lucide-vue-next'
import { useAppStore } from './stores/app'
import { useAgentStore } from './stores/agent'
import { useWorkspaceStore } from './stores/workspace'
import { useProductTourStore } from './stores/product-tour'
import BackgroundProfileDialog from './components/BackgroundProfileDialog.vue'
import ProductTour from './components/ProductTour.vue'
import logoUrl from './assets/logo.png'
import wordmarkUrl from './assets/wordmark.png'
import wordmarkDarkUrl from './assets/wordmark-dark.png'

const RAIL_EXPANDED_KEY = 'cpppilot.activity-rail.expanded'
const INDICATOR_MOVE_MS = 340

const appStore = useAppStore()
const agent = useAgentStore()
const workspace = useWorkspaceStore()
const productTour = useProductTourStore()
const route = useRoute()
const router = useRouter()
const railExpanded = ref(false)
const logoFailed = ref(false)
const isDarkTheme = ref(false)
const railTrackEl = ref<HTMLElement | null>(null)
const indicator = ref({ top: 0, height: 38, visible: false })
const indicatorMoving = ref(false)
const backgroundDialogVisible = ref(false)
let unlisten: (() => void) | undefined
let unlistenNavigate: (() => void) | undefined
let themeObserver: MutationObserver | undefined
let moveTimer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined
let backgroundCheckGeneration = 0

function syncTheme() {
  isDarkTheme.value = document.documentElement.classList.contains('dark')
}

async function updateRailIndicator(animated = true) {
  await nextTick()
  const root = railTrackEl.value
  if (!root) {
    indicator.value = { ...indicator.value, visible: false }
    indicatorMoving.value = false
    return
  }
  const active = root.querySelector<HTMLElement>('.rail-button.active')
  if (!active) {
    indicator.value = { ...indicator.value, visible: false }
    indicatorMoving.value = false
    return
  }

  const next = {
    top: active.offsetTop,
    height: active.offsetHeight,
    visible: true
  }

  const shouldAnimate = animated
    && indicator.value.visible
    && (indicator.value.top !== next.top || indicator.value.height !== next.height)

  if (shouldAnimate) {
    indicatorMoving.value = true
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      indicatorMoving.value = false
      moveTimer = undefined
    }, INDICATOR_MOVE_MS)
  }
  // 动画进行中的二次校准只更新位置，不强制关掉 moving（否则竖线“气泡”动效会被掐掉）

  indicator.value = next
}

async function checkBackgroundDialog() {
  const generation = ++backgroundCheckGeneration
  if (route.path === '/onboarding' || !appStore.settings.onboardingCompleted || appStore.settings.onboardingStatus === 'pending') {
    backgroundDialogVisible.value = false
    return
  }
  const profile = await agent.loadBackground()
  if (generation !== backgroundCheckGeneration || route.path === '/onboarding') return
  backgroundDialogVisible.value = !profile
}

onMounted(async () => {
  try {
    railExpanded.value = localStorage.getItem(RAIL_EXPANDED_KEY) === '1'
  } catch {
    railExpanded.value = false
  }
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  await appStore.init()
  syncTheme()
  if ((!appStore.settings.onboardingCompleted || appStore.settings.onboardingStatus === 'pending') && route.path !== '/onboarding') await router.replace('/onboarding')
  else await checkBackgroundDialog()
  await workspace.loadProjects()
  unlisten = window.cppPet.workspace.onChanged(event => workspace.handleExternal(event))
  unlistenNavigate = window.cppPet.app.onNavigate(event => { void router.push({ path: event.path, query: event.query ?? {} }) })
  await updateRailIndicator(false)
  if (typeof ResizeObserver !== 'undefined' && railTrackEl.value) {
    resizeObserver = new ResizeObserver(() => { void updateRailIndicator(false) })
    resizeObserver.observe(railTrackEl.value)
  }
})

onBeforeUnmount(() => {
  unlisten?.()
  unlistenNavigate?.()
  themeObserver?.disconnect()
  resizeObserver?.disconnect()
  if (moveTimer) clearTimeout(moveTimer)
})

watch(() => route.fullPath, async () => {
  await nextTick()
  await updateRailIndicator(true)
  // 仅补测坐标，保留 moving 状态以完成滑块/竖线动画
  requestAnimationFrame(() => {
    const root = railTrackEl.value
    const active = root?.querySelector<HTMLElement>('.rail-button.active')
    if (!active) return
    indicator.value = {
      top: active.offsetTop,
      height: active.offsetHeight,
      visible: true
    }
  })
})
watch(() => route.path, () => { void checkBackgroundDialog() })
watch(railExpanded, async () => {
  await nextTick()
  requestAnimationFrame(() => { void updateRailIndicator(false) })
})

const primaryNav = [
  { to: '/home', label: '首页', icon: Home },
  { to: '/workspace', label: '工作区', icon: Code2 },
  { to: '/knowledge', label: '知识树', icon: BookOpen },
  { to: '/practice', label: '练习', icon: Dumbbell },
  { to: '/runs', label: '助教记录', icon: Workflow }
]

function isRailNavActive(to: string) {
  // 精确匹配段前缀，避免工作区路由下指示器丢失或误匹配
  return route.path === to || route.path.startsWith(`${to}/`)
}
const settingsNav = { to: '/settings', label: '设置', icon: Settings }
const appTitle = 'CppPilot'
const titleContext = computed(() => workspace.currentProject?.name
  ? `项目 · ${workspace.currentProject.name}`
  : 'C++ 编程助教')
const activeWordmark = computed(() => (isDarkTheme.value ? wordmarkDarkUrl : wordmarkUrl))

function toggleRail() {
  railExpanded.value = !railExpanded.value
  try {
    localStorage.setItem(RAIL_EXPANDED_KEY, railExpanded.value ? '1' : '0')
  } catch {
    /* ignore storage failures */
  }
}

const indicatorStyle = computed(() => ({
  transform: `translate3d(0, ${indicator.value.top}px, 0)`,
  height: `${indicator.value.height}px`,
  opacity: indicator.value.visible ? 1 : 0
}))
</script>

<template>
  <div :class="['app-shell', { 'onboarding-shell': route.path === '/onboarding', 'rail-expanded': railExpanded && route.path !== '/onboarding' }]">
    <header class="titlebar">
      <div class="brand-mark"><span class="brand-mark-fallback">CP</span><img v-if="!logoFailed" :src="logoUrl" alt="CppPilot" @error="logoFailed = true" /></div>
      <span class="title-project">{{ appTitle }}</span>
      <span class="title-context">{{ titleContext }}</span>
    </header>
    <aside v-if="route.path !== '/onboarding'" :class="['activity-rail', { expanded: railExpanded }]" :aria-expanded="railExpanded" data-tour="activity-rail">
      <div ref="railTrackEl" class="rail-track">
        <div
          class="rail-indicator"
          :class="{ moving: indicatorMoving, visible: indicator.visible }"
          :style="indicatorStyle"
          aria-hidden="true"
        >
          <span class="rail-indicator-bg" />
          <span class="rail-indicator-bar" />
        </div>

        <button class="rail-toggle" type="button" :title="railExpanded ? '收起侧边栏' : '展开侧边栏'" :aria-label="railExpanded ? '收起侧边栏' : '展开侧边栏'" @click="toggleRail">
          <ChevronsLeft v-if="railExpanded" :size="18" />
          <ChevronsRight v-else :size="18" />
          <span class="rail-label">{{ railExpanded ? '收起' : '展开' }}</span>
        </button>

        <router-link
          v-for="item in primaryNav"
          :key="item.to"
          :to="item.to"
          :class="['rail-button', { active: isRailNavActive(item.to) }]"
          :title="item.label"
        >
          <component :is="item.icon" :size="19" />
          <span class="rail-label">{{ item.label }}</span>
        </router-link>

        <div class="rail-spacer" aria-hidden="true" />

        <button class="rail-button" type="button" title="新手帮助" aria-label="新手帮助" @click="productTour.replay()">
          <CircleHelp :size="19" />
          <span class="rail-label">新手帮助</span>
        </button>

        <router-link
          :to="settingsNav.to"
          :class="['rail-button', { active: isRailNavActive(settingsNav.to) }]"
          :title="settingsNav.label"
        >
          <component :is="settingsNav.icon" :size="19" />
          <span class="rail-label">{{ settingsNav.label }}</span>
        </router-link>

        <div class="rail-wordmark" aria-hidden="true">
          <img :src="activeWordmark" alt="" />
        </div>
      </div>
    </aside>
    <main class="app-content"><router-view /></main>
    <ProductTour :blocked="route.path === '/onboarding' || backgroundDialogVisible" />
    <BackgroundProfileDialog v-model="backgroundDialogVisible" required @saved="backgroundDialogVisible = false" />
    <footer class="statusbar">
      <span v-if="appStore.bootstrap?.recoveryMode" class="danger"><i class="status-dot" /> 当前为只读恢复模式，请先检查数据后再继续学习</span>
      <span v-else><i class="status-dot" /> CppPilot 已就绪，可以开始你的 C++ 学习之旅</span>
    </footer>
    <div v-if="appStore.error || workspace.error" class="error-toast">
      <strong>{{ (appStore.error || workspace.error)?.message }}</strong>
      <span>{{ (appStore.error || workspace.error)?.userAction }}</span>
      <button @click="appStore.setError(null); workspace.error = null">关闭</button>
    </div>
  </div>
</template>
