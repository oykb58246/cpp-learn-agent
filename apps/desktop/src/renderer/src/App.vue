<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpen, Bot, ChartNoAxesCombined, Code2, GraduationCap, Home, Settings, Workflow } from 'lucide-vue-next'
import { useAppStore } from './stores/app'
import { useWorkspaceStore } from './stores/workspace'

const appStore = useAppStore()
const workspace = useWorkspaceStore()
const route = useRoute()
const router = useRouter()
let unlisten: (() => void) | undefined
onMounted(async () => {
  await appStore.init()
  if ((!appStore.settings.onboardingCompleted || appStore.settings.onboardingStatus === 'pending') && route.path !== '/onboarding') await router.replace('/onboarding')
  await workspace.loadProjects()
  unlisten = window.cppPet.workspace.onChanged(event => workspace.handleExternal(event))
})
onBeforeUnmount(() => unlisten?.())
const nav = [
  { to: '/home', label: '首页', icon: Home },
  { to: '/workspace', label: '工作区', icon: Code2 },
  { to: '/knowledge', label: '知识树', icon: BookOpen },
  { to: '/practice', label: '练习', icon: GraduationCap },
  { to: '/reports', label: '报告', icon: ChartNoAxesCombined },
  { to: '/runs', label: 'Agent 记录', icon: Workflow },
  { to: '/settings', label: '设置', icon: Settings }
]
const projectName = computed(() => workspace.currentProject?.name ?? '宠码学伴')
</script>

<template>
  <div :class="['app-shell', { 'onboarding-shell': route.path === '/onboarding' }]">
    <header class="titlebar">
      <div class="brand-mark"><Bot :size="17" /></div>
      <span class="title-project">{{ projectName }}</span>
      <span class="title-context">C++ 学习工作台</span>
    </header>
    <aside v-if="route.path !== '/onboarding'" class="activity-rail">
      <router-link v-for="item in nav" :key="item.to" :to="item.to" :class="['rail-button', { active: route.path.startsWith(item.to) }]" :title="item.label">
        <component :is="item.icon" :size="19" /><span>{{ item.label }}</span>
      </router-link>
    </aside>
    <main class="app-content"><router-view /></main>
    <footer class="statusbar">
      <span><i class="status-dot" /> 数据库已连接</span>
      <span v-if="appStore.bootstrap?.recoveryMode" class="danger">只读恢复模式</span>
      <span>H2 · C++ Tools</span><span class="status-spacer" /><span>Windows</span><span>UTF-8</span>
    </footer>
    <div v-if="appStore.error || workspace.error" class="error-toast">
      <strong>{{ (appStore.error || workspace.error)?.message }}</strong>
      <span>{{ (appStore.error || workspace.error)?.userAction }}</span>
      <button @click="appStore.setError(null); workspace.error = null">关闭</button>
    </div>
  </div>
</template>
