<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Bot, BookOpen, CircleAlert, Clock3, FolderOpen, MessageSquare, Plus, Search, Wrench, X } from 'lucide-vue-next'
import ProjectDialog from '../components/ProjectDialog.vue'
import BeginnerQuickStart from '../components/BeginnerQuickStart.vue'
import { useAppStore } from '../stores/app'
import { useWorkspaceStore } from '../stores/workspace'

const app = useAppStore()
const workspace = useWorkspaceStore()
const router = useRouter()
const dialog = ref(false)
const query = ref('')

// 首页列表以 workspace.projects 为准，保证删除/创建后即时刷新
const projects = computed(() => workspace.projects.filter(item => item.name.toLowerCase().includes(query.value.toLowerCase())))

onMounted(() => {
  void workspace.loadProjects()
  void app.refreshProjects()
})
const showEnvironmentReminder = computed(() => app.settings.onboardingStatus === 'skipped' && !app.settings.onboardingReminderDismissed)
const toolchainReady = computed(() => app.dashboard?.environment.find(item => item.id === 'compiler')?.status === 'ready')

const eventLabel = (type: string) => ({
  'project.created': '创建项目',
  'project.removed': '移除项目',
  'file.created': '新建文件',
  'file.patched': '保存文件',
  'file.deleted': '删除文件',
  'file.renamed': '移动或重命名',
  'snapshot.created': '创建快照',
  'snapshot.restored': '恢复快照',
  'snapshot.deleted': '删除快照'
}[type] ?? type)

async function openProject(id: string) {
  await workspace.openProject(id)
  await router.push(`/workspace/${id}`)
}

async function created(project: { id: string }) {
  await Promise.all([workspace.loadProjects(), app.refreshProjects()])
  await workspace.openProject(project.id)
  await router.push(`/workspace/${project.id}`)
}

async function dismissOnboardingReminder() {
  await app.updateSettings({ onboardingReminderDismissed: true })
}

function goSettingsToolchain() {
  // hash history 下二级 # 不可靠，使用 query 定位设置模块
  void router.push({ path: '/settings', query: { section: 'toolchains' } })
}

function goAgentRuns() {
  void router.push('/runs')
}

function continueLatestProject() {
  const project = projects.value[0]
  if (project) void openProject(project.id)
}

function goOnboarding() {
  void router.push('/onboarding')
}
</script>

<template>
  <div class="home-view page-scroll">
    <section class="page-header" data-tour="home-primary">
      <div>
        <p class="eyebrow">Today's Desk</p>
        <h1>开始处理你的 C++ 问题</h1>
        <p>打开一个项目开始编写、编译和调试；遇到不懂的概念或报错时，随时向助教提问。</p>
      </div>
      <button v-if="projects[0]" class="primary-command" @click="continueLatestProject"><FolderOpen :size="17" />打开项目并继续</button>
      <button v-else class="primary-command" @click="dialog = true"><Plus :size="17" />新建项目</button>
    </section>

    <section v-if="app.bootstrap?.recoveryMode" class="recovery-banner">
      <CircleAlert :size="18" />
      <div>
        <strong>数据处于只读恢复模式</strong>
        <span>原数据库已保留，请先检查备份再继续写入。</span>
      </div>
      <button class="secondary-command" @click="router.push({ path: '/settings', query: { section: 'data' } })">查看数据设置</button>
    </section>

    <section v-if="showEnvironmentReminder" class="environment-reminder">
      <Wrench :size="19" />
      <div>
        <strong>环境初始化尚未完成</strong>
        <span>可去设置页检测并绑定 C++ 工具链，或先查看 Agent 记录区了解后续能力。</span>
      </div>
      <div class="reminder-actions">
        <button class="primary-command" @click="goSettingsToolchain">去设置检测绑定</button>
        <button class="secondary-command" @click="goOnboarding">环境向导</button>
        <button class="secondary-command" @click="goAgentRuns"><Bot :size="15" />Agent 区</button>
      </div>
      <button class="icon-command" title="关闭提醒" @click="dismissOnboardingReminder"><X :size="16" /></button>
    </section>

    <section v-else-if="!toolchainReady" class="environment-reminder muted-reminder">
      <Wrench :size="19" />
      <div>
        <strong>尚未绑定可用工具链</strong>
        <span>编译运行前建议先完成检测与绑定；也可先去 Agent 记录区查看任务流预览。</span>
      </div>
      <div class="reminder-actions">
        <button class="primary-command" @click="goSettingsToolchain">检测并绑定</button>
        <button class="secondary-command" @click="goAgentRuns"><Bot :size="15" />Agent 区</button>
      </div>
    </section>

    <BeginnerQuickStart />

    <section class="command-row">
      <div class="search-field"><Search :size="17" /><input v-model="query" placeholder="查找最近项目" /></div>
      <button class="secondary-command" @click="dialog = true"><FolderOpen :size="17" />导入项目</button>
    </section>

    <div class="home-grid">
      <section class="plain-section recent-section">
        <header>
          <div>
            <h2>最近项目</h2>
            <span>{{ projects.length }} 个可用项目</span>
          </div>
          <button class="icon-command" title="新建项目" @click="dialog = true"><Plus :size="17" /></button>
        </header>
        <div v-if="!projects.length" class="empty-state">
          <FolderOpen :size="28" />
          <strong>还没有项目</strong>
          <span>先创建或导入一个 C++ 项目。打开后可以直接编辑、编译、运行，或让助教协助排错。</span>
          <button class="primary-command" @click="dialog = true">创建第一个项目</button>
        </div>
        <button v-for="project in projects" :key="project.id" class="project-row" @click="openProject(project.id)">
          <span class="project-icon">C++</span>
          <div>
            <strong>{{ project.name }}</strong>
            <span>{{ project.type }} · {{ project.creationMode }}</span>
          </div>
          <time><Clock3 :size="14" />{{ new Date(project.lastOpenedAt).toLocaleDateString() }}</time>
          <ArrowRight :size="16" />
        </button>
        <div v-if="app.bootstrap?.recentEvents.length" class="activity-block">
          <h3>最近活动</h3>
          <div v-for="event in app.bootstrap.recentEvents.slice(0, 5)" :key="event.eventId" class="activity-row">
            <i class="status-dot" />
            <strong>{{ eventLabel(event.type) }}</strong>
            <span>{{ new Date(event.occurredAt).toLocaleString() }}</span>
          </div>
        </div>
      </section>
      <aside class="home-aside">
        <section class="plain-section learning-section">
          <header>
            <div>
              <h2>你现在可以做什么</h2>
              <span>从项目或问题开始，不需要完成课程</span>
            </div>
          </header>
          <div class="assistant-action-row">
            <FolderOpen :size="17" /><div><strong>打开或创建项目</strong><span>在工作区里编辑、构建和运行 C++ 代码。</span></div><button class="icon-command" title="新建项目" @click="dialog = true"><Plus :size="16" /></button>
          </div>
          <div class="assistant-action-row">
            <MessageSquare :size="17" /><div><strong>向助教描述问题</strong><span>可解释代码、分析报错或协助定位逻辑问题。</span></div><button class="icon-command" title="打开助教记录" @click="goAgentRuns"><ArrowRight :size="16" /></button>
          </div>
        </section>
        <section class="plain-section task-section">
          <header>
            <div>
              <h2>助教如何解释</h2>
              <span>基于你主动提供的背景调整说明</span>
            </div>
          </header>
          <div class="assistant-action-row">
            <BookOpen :size="17" /><div><strong>查看知识树</strong><span>标注学过的概念和希望重点解释的内容；未标注概念会在讲解时先做介绍。</span></div><button class="icon-command" title="打开知识树" @click="router.push('/knowledge')"><ArrowRight :size="16" /></button>
          </div>
        </section>
      </aside>
    </div>
    <ProjectDialog v-model="dialog" @created="created" />
  </div>
</template>
