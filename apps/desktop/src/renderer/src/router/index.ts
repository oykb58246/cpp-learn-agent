import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import WorkspaceView from '../views/WorkspaceView.vue'
import PlaceholderView from '../views/PlaceholderView.vue'
import SettingsView from '../views/SettingsView.vue'
import OnboardingView from '../views/OnboardingView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/onboarding', component: OnboardingView },
    { path: '/home', component: HomeView },
    { path: '/workspace/:projectId?', component: WorkspaceView },
    { path: '/knowledge', component: PlaceholderView, props: { kind: 'knowledge' } },
    { path: '/practice', component: PlaceholderView, props: { kind: 'practice' } },
    { path: '/reports', component: PlaceholderView, props: { kind: 'reports' } },
    { path: '/runs', component: PlaceholderView, props: { kind: 'runs' } },
    { path: '/settings', component: SettingsView }
  ]
})
