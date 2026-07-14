<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CheckCircle2, Database, FolderRoot, MonitorCog, Moon, Play, RefreshCw, Sparkles, Sun, Trash2, Wrench } from 'lucide-vue-next'
import type {
  ToolchainBindingState,
  ToolchainCandidate,
  ToolchainDetectionResult,
  ToolchainProbeResult
} from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const router = useRouter()
const detection = ref<ToolchainDetectionResult | null>(null)
const bindings = ref<ToolchainBindingState>({ profiles: [] })
const probes = ref<Record<string, ToolchainProbeResult>>({})
const detecting = ref(false)
const activeAction = ref('')
const activeProfile = computed(() => bindings.value.profiles.find(item => item.id === bindings.value.activeProfileId))

onMounted(loadBindings)

async function loadBindings() {
  const result = await window.cppPet.toolchains.list()
  if (result.ok) bindings.value = result.data
  else app.setError(result.error)
}

async function detectToolchains() {
  detecting.value = true
  const result = await window.cppPet.toolchains.detect()
  if (result.ok) detection.value = result.data
  else app.setError(result.error)
  detecting.value = false
}

async function probe(candidate: ToolchainCandidate) {
  activeAction.value = `probe:${candidate.id}`
  const result = await window.cppPet.toolchains.probe({ candidateId: candidate.id })
  if (result.ok) probes.value[candidate.id] = result.data
  else app.setError(result.error)
  activeAction.value = ''
}

async function bind(candidate: ToolchainCandidate) {
  activeAction.value = `bind:${candidate.id}`
  const result = await window.cppPet.toolchains.bind({ candidateId: candidate.id })
  if (result.ok) await Promise.all([loadBindings(), app.init()])
  else app.setError(result.error)
  activeAction.value = ''
}

async function checkHealth(profileId: string) {
  activeAction.value = `health:${profileId}`
  const result = await window.cppPet.toolchains.health({ profileId })
  if (!result.ok) app.setError(result.error)
  else if (!result.data.healthy) app.setError({ code: 'TOOLCHAIN_HEALTH_FAILED', message: result.data.reason ?? '工具链健康检查失败。', retryable: true, userAction: '重新检测并绑定可用工具链。' })
  activeAction.value = ''
}

async function unbind(profileId: string) {
  activeAction.value = `unbind:${profileId}`
  const result = await window.cppPet.toolchains.unbind({ profileId })
  if (result.ok) await Promise.all([loadBindings(), app.init()])
  else app.setError(result.error)
  activeAction.value = ''
}

function familyName(family: ToolchainCandidate['family']) {
  return family === 'gcc' ? 'GCC' : family === 'clang' ? 'Clang' : 'MSVC'
}
</script>

<template>
  <div class="settings-view page-scroll">
    <section class="page-header">
      <div>
        <p class="eyebrow">应用设置</p>
        <h1>偏好与开发环境</h1>
        <p>管理工作区、数据和经过真实编译验证的 C++ 工具链。</p>
      </div>
    </section>
    <div class="settings-layout">
      <nav>
        <a href="#appearance">外观</a>
        <a href="#toolchains" class="active">C++ 工具链</a>
        <a href="#workspace">工作区</a>
        <a href="#data">数据</a>
      </nav>
      <main>
        <section id="appearance" class="settings-section">
          <header><Sun :size="18" /><div><h2>外观</h2><p>默认跟随 Windows，也可固定浅色或深色。</p></div></header>
          <div class="setting-row">
            <span>主题</span>
            <div class="segmented compact">
              <button :class="{active: app.settings.theme === 'system'}" @click="app.updateSettings({theme:'system'})"><MonitorCog :size="15" />系统</button>
              <button :class="{active: app.settings.theme === 'light'}" @click="app.updateSettings({theme:'light'})"><Sun :size="15" />浅色</button>
              <button :class="{active: app.settings.theme === 'dark'}" @click="app.updateSettings({theme:'dark'})"><Moon :size="15" />深色</button>
            </div>
          </div>
        </section>

        <section id="toolchains" class="settings-section">
          <header>
            <Wrench :size="18" />
            <div><h2>C++ 工具链</h2><p>候选项必须通过 Hello World 编译与运行后才能绑定。</p></div>
            <div class="section-actions">
              <button class="secondary-command" @click="router.push('/onboarding')">
                <Sparkles :size="15" />环境向导
              </button>
              <button class="secondary-command" :disabled="detecting" @click="detectToolchains">
                <RefreshCw :size="15" :class="{ spinning: detecting }" />{{ detecting ? '检测中' : '重新检测' }}
              </button>
            </div>
          </header>

          <div v-if="activeProfile" class="active-toolchain-line">
            <CheckCircle2 :size="17" />
            <div>
              <strong>当前：{{ familyName(activeProfile.family) }} {{ activeProfile.version }}</strong>
              <span>{{ activeProfile.compilerPath }}</span>
            </div>
            <button class="icon-command" title="健康检查" :disabled="activeAction === `health:${activeProfile.id}`" @click="checkHealth(activeProfile.id)"><RefreshCw :size="15" /></button>
            <button class="icon-command danger" title="解绑工具链" :disabled="activeAction === `unbind:${activeProfile.id}`" @click="unbind(activeProfile.id)"><Trash2 :size="15" /></button>
          </div>

          <div v-if="!detection" class="toolchain-empty">
            <MonitorCog :size="24" />
            <strong>尚未扫描本机开发环境</strong>
            <span>检测 GCC、Clang、MSVC、CMake、调试器和 VS Code，不会自动更改系统配置。</span>
            <button class="primary-command" :disabled="detecting" @click="detectToolchains"><RefreshCw :size="15" />开始检测</button>
          </div>

          <template v-else>
            <div class="environment-summary">
              <span>发现 {{ detection.candidates.length }} 个编译器候选</span>
              <span>{{ detection.tools.map(item => item.kind).join(' · ') || '未发现辅助工具' }}</span>
            </div>
            <div v-for="candidate in detection.candidates" :key="candidate.id" class="toolchain-row">
              <div class="toolchain-family">{{ familyName(candidate.family) }}</div>
              <div class="toolchain-detail">
                <strong>{{ candidate.version }} · {{ candidate.targetArch }}</strong>
                <span>{{ candidate.compilerPath }}</span>
                <small>{{ candidate.capabilities.debug ? '可调试' : '未发现调试器' }} · {{ candidate.cmakeGenerator ?? '未发现 CMake 生成器' }}</small>
                <b v-if="probes[candidate.id]" :class="{ passed: probes[candidate.id]?.success }">
                  {{ probes[candidate.id]?.success ? '烟雾验证通过' : probes[candidate.id]?.failureReason }}
                </b>
              </div>
              <button class="secondary-command" :disabled="Boolean(activeAction)" @click="probe(candidate)"><Play :size="14" />验证</button>
              <button class="primary-command" :disabled="Boolean(activeAction)" @click="bind(candidate)"><CheckCircle2 :size="14" />验证并绑定</button>
            </div>
            <div v-if="!detection.candidates.length" class="toolchain-empty compact-empty">
              <strong>没有找到可用编译器</strong>
              <span>请安装 MinGW-w64、LLVM 或 Visual Studio C++ Build Tools 后重新检测。</span>
            </div>
          </template>
        </section>

        <section id="workspace" class="settings-section">
          <header><FolderRoot :size="18" /><div><h2>授权工作区</h2><p>只有明确授权的 Root 才能被应用写入。</p></div></header>
          <div v-for="item in app.workspaces" :key="item.id" class="workspace-setting">
            <div><strong>{{ item.name }}</strong><span>{{ item.rootPath }}</span></div>
            <b :class="item.trustState">{{ item.trustState === 'trusted' ? '已信任' : item.trustState === 'inspection' ? '只读检查' : '已撤销' }}</b>
          </div>
          <button class="secondary-command" @click="app.selectWorkspace">添加工作区</button>
        </section>

        <section id="data" class="settings-section">
          <header><Database :size="18" /><div><h2>本地数据</h2><p>SQLite、快照和日志保存在当前 Windows 用户数据目录。</p></div></header>
          <div class="data-status"><i class="status-dot" /><span>数据库与 WAL 正常</span><small>迁移前自动备份，失败时进入只读恢复模式</small></div>
        </section>
      </main>
    </div>
  </div>
</template>
