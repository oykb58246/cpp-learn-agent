import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import WorkspaceView from '../views/WorkspaceView.vue'
import RunsView from '../views/RunsView.vue'
import KnowledgeView from '../views/KnowledgeView.vue'
import SettingsView from '../views/SettingsView.vue'
import OnboardingView from '../views/OnboardingView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/onboarding', component: OnboardingView },
    { path: '/home', component: HomeView },
    { path: '/workspace/:projectId?', component: WorkspaceView },
    { path: '/knowledge', component: KnowledgeView },
    { path: '/practice', redirect: '/runs' },
    { path: '/reports', redirect: '/runs' },
    { path: '/runs', component: RunsView },
    { path: '/settings', component: SettingsView }
  ]
})
