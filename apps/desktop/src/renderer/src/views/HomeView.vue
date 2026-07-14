<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CheckCircle2, CircleAlert, Clock3, FolderOpen, Plus, Search, ShieldCheck } from 'lucide-vue-next'
import ProjectDialog from '../components/ProjectDialog.vue'
import { useAppStore } from '../stores/app'
import { useWorkspaceStore } from '../stores/workspace'

const app = useAppStore(); const workspace = useWorkspaceStore(); const router = useRouter(); const dialog = ref(false); const query = ref('')
const projects = computed(() => app.projects.filter(item => item.name.toLowerCase().includes(query.value.toLowerCase())))
const eventLabel = (type: string) => ({ 'project.created': '创建项目', 'project.removed': '移除项目', 'file.created': '新建文件', 'file.patched': '保存文件', 'file.deleted': '删除文件', 'file.renamed': '移动或重命名', 'snapshot.created': '创建快照', 'snapshot.restored': '恢复快照', 'snapshot.deleted': '删除快照' }[type] ?? type)
async function openProject(id: string) { await workspace.openProject(id); await router.push(`/workspace/${id}`) }
async function created(project: { id: string }) { await workspace.openProject(project.id); await router.push(`/workspace/${project.id}`) }
</script>

<template>
  <div class="home-view page-scroll">
    <section class="page-header"><div><p class="eyebrow">今日工作台</p><h1>继续你的 C++ 学习</h1><p>项目、错误和工具状态都在同一个可追踪工作流中。</p></div><button class="primary-command" @click="dialog = true"><Plus :size="17" />新建项目</button></section>
    <section v-if="app.bootstrap?.recoveryMode" class="recovery-banner"><CircleAlert :size="18" /><div><strong>数据处于只读恢复模式</strong><span>原数据库已保留，请先检查备份再继续写入。</span></div></section>
    <section class="command-row"><div class="search-field"><Search :size="17" /><input v-model="query" placeholder="查找最近项目" /></div><button class="secondary-command" @click="dialog = true"><FolderOpen :size="17" />导入项目</button></section>
    <section class="status-strip">
      <div v-for="item in app.dashboard?.environment" :key="item.id" class="status-item"><i :class="['status-indicator', item.status]" /><div><span>{{ item.label }}</span><small>{{ item.detail }}</small></div></div>
    </section>
    <div class="home-grid">
      <section class="plain-section recent-section"><header><div><h2>最近项目</h2><span>{{ projects.length }} 个可用项目</span></div><button class="icon-command" title="新建项目" @click="dialog = true"><Plus :size="17" /></button></header>
        <div v-if="!projects.length" class="empty-state"><FolderOpen :size="28" /><strong>还没有学习项目</strong><span>选择一个工作区，然后创建单文件、多文件或 CMake 项目。</span><button class="primary-command" @click="dialog = true">建立第一个项目</button></div>
        <button v-for="project in projects" :key="project.id" class="project-row" @click="openProject(project.id)"><span class="project-icon">C++</span><div><strong>{{ project.name }}</strong><span>{{ project.type }} · {{ project.creationMode }}</span></div><time><Clock3 :size="14" />{{ new Date(project.lastOpenedAt).toLocaleDateString() }}</time><ArrowRight :size="16" /></button>
        <div v-if="app.bootstrap?.recentEvents.length" class="activity-block"><h3>最近活动</h3><div v-for="event in app.bootstrap.recentEvents.slice(0, 5)" :key="event.eventId" class="activity-row"><i class="status-dot" /><strong>{{ eventLabel(event.type) }}</strong><span>{{ new Date(event.occurredAt).toLocaleString() }}</span></div></div>
      </section>
      <aside class="home-aside">
        <section class="plain-section learning-section"><header><div><h2>学习进度</h2><span>确定性 Mock · C 阶段接入</span></div></header><div class="concept-line"><div><span>当前知识</span><strong>{{ app.dashboard?.learning.concept }}</strong></div><b>{{ app.dashboard?.learning.progress }}%</b></div><div class="progress-track"><i :style="{ width: `${app.dashboard?.learning.progress ?? 0}%` }" /></div><div class="learning-meta"><span><ShieldCheck :size="15" />等级 {{ app.dashboard?.learning.level }}</span><span><CircleAlert :size="15" />待复习 {{ app.dashboard?.learning.reviewCount }}</span></div></section>
        <section class="plain-section task-section"><header><div><h2>待处理</h2><span>下一步建议</span></div></header><div v-for="task in app.dashboard?.tasks" :key="task.id" class="task-row"><CheckCircle2 v-if="task.status === 'done'" :size="16" /><CircleAlert v-else-if="task.status === 'blocked'" :size="16" /><span v-else class="task-circle" /><div><strong>{{ task.title }}</strong><span>{{ task.meta }}</span></div></div></section>
      </aside>
    </div>
    <ProjectDialog v-model="dialog" @created="created" />
  </div>
</template>
