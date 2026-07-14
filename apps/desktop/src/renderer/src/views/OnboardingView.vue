<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Code2,
  Download,
  ExternalLink,
  FolderRoot,
  Gauge,
  PackageCheck,
  MonitorCog,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench
} from 'lucide-vue-next'
import type {
  EnvironmentDownloadTarget,
  EnvironmentInstallerStatus,
  EnvironmentInstallTarget,
  ToolchainBindingState,
  ToolchainCandidate,
  ToolchainDetectionResult
} from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const router = useRouter()
const step = ref(0)
const detection = ref<ToolchainDetectionResult | null>(null)
const bindings = ref<ToolchainBindingState>({ profiles: [] })
const detecting = ref(false)
const binding = ref(false)
const selectedCandidateId = ref('')
const selectedWorkspaceId = ref('')
const toolchainMessage = ref('')
const installMessage = ref('')
const installingTarget = ref<EnvironmentInstallTarget | ''>('')
const installerStatus = ref<EnvironmentInstallerStatus | null>(null)
const skipConfirming = ref(false)

const steps = [
  { title: '开始', detail: '了解初始化流程', icon: Sparkles },
  { title: '环境检测', detail: '扫描本机开发工具', icon: MonitorCog },
  { title: '工具链', detail: '验证并绑定编译器', icon: Wrench },
  { title: '工作区', detail: '授权代码保存位置', icon: FolderRoot },
  { title: '完成', detail: '进入 C++ 工作台', icon: CheckCircle2 }
]

const activeProfile = computed(() => bindings.value.profiles.find(item => item.id === bindings.value.activeProfileId))
const selectedCandidate = computed(() => detection.value?.candidates.find(item => item.id === selectedCandidateId.value))
const selectedWorkspace = computed(() => app.workspaces.find(item => item.id === selectedWorkspaceId.value))
const hasTool = (kind: ToolchainDetectionResult['tools'][number]['kind']) => detection.value?.tools.some(item => item.kind === kind) ?? false
const environmentRows = computed(() => [
  {
    label: 'C++ 编译器',
    ready: Boolean(detection.value?.candidates.length),
    detail: detection.value?.candidates.length ? `发现 ${detection.value.candidates.length} 个候选` : '需要 GCC、Clang 或 MSVC',
    target: 'msys2' as EnvironmentDownloadTarget
  },
  {
    label: '调试器',
    ready: detection.value?.candidates.some(item => item.family === 'gcc' && Boolean(item.debuggerPath)) ?? false,
    detail: detection.value?.candidates.some(item => item.family === 'gcc' && item.debuggerPath) ? '已发现 GDB' : '当前完整调试推荐 GCC + GDB',
    target: 'msys2' as EnvironmentDownloadTarget
  },
  {
    label: '代码智能',
    ready: hasTool('clangd'),
    detail: hasTool('clangd') ? 'clangd 可用' : '补全、悬停和定义跳转需要 clangd',
    target: 'llvm' as EnvironmentDownloadTarget
  },
  {
    label: '工程构建',
    ready: hasTool('cmake') && hasTool('ctest'),
    detail: hasTool('cmake') && hasTool('ctest') ? 'CMake 与 CTest 可用' : '多文件工程和测试需要 CMake',
    target: 'cmake' as EnvironmentDownloadTarget
  },
  {
    label: '外部编辑器',
    ready: hasTool('vscode'),
    detail: hasTool('vscode') ? 'VS Code 可用' : '可选，用于外部编辑器联动',
    target: 'vscode' as EnvironmentDownloadTarget
  }
])
const readyCount = computed(() => environmentRows.value.filter(item => item.ready).length)
const installCatalog: Record<EnvironmentInstallTarget, { label: string; detail: string; after?: string }> = {
  msys2: {
    label: 'MSYS2 + UCRT64',
    detail: '推荐给初学者，先安装 MSYS2，再在 MSYS2 UCRT64 终端安装 GCC、GDB 和基础构建工具。',
    after: 'pacman -S --needed mingw-w64-ucrt-x86_64-toolchain mingw-w64-ucrt-x86_64-gdb'
  },
  llvm: { label: 'LLVM 工具集', detail: '提供 clangd 与 clang-tidy，用于代码补全、跳转和静态分析。' },
  cmake: { label: 'CMake', detail: '用于多文件工程配置、构建和 CTest 测试。' },
  vscode: { label: 'Visual Studio Code', detail: '可选外部编辑器，安装后可以从工作区新窗口打开并定位代码。' }
}
const installPlans = computed(() => {
  if (!detection.value) return []
  const targets = new Set<EnvironmentInstallTarget>()
  if (!detection.value.candidates.length || !detection.value.candidates.some(item => item.family === 'gcc' && item.debuggerPath)) targets.add('msys2')
  if (!hasTool('clangd')) targets.add('llvm')
  if (!hasTool('cmake') || !hasTool('ctest')) targets.add('cmake')
  if (!hasTool('vscode')) targets.add('vscode')
  return [...targets].map(target => ({ target, ...installCatalog[target] }))
})
const isFirstRun = computed(() => app.settings.onboardingStatus === 'pending')

onMounted(async () => {
  await Promise.all([loadBindings(), loadInstallerStatus()])
  if (app.workspaces[0]) selectedWorkspaceId.value = app.workspaces[0].id
})

async function loadBindings() {
  const result = await window.cppPet.toolchains.list()
  if (result.ok) bindings.value = result.data
  else app.setError(result.error)
}

async function detectEnvironment() {
  detecting.value = true
  toolchainMessage.value = ''
  const result = await window.cppPet.toolchains.detect()
  detecting.value = false
  if (!result.ok) {
    app.setError(result.error)
    return
  }
  detection.value = result.data
  const recommended = result.data.candidates.find(item => item.family === 'gcc' && item.debuggerPath)
    ?? result.data.candidates.find(item => item.family === 'gcc')
    ?? result.data.candidates.find(item => item.family === 'clang')
    ?? result.data.candidates[0]
  selectedCandidateId.value = recommended?.id ?? ''
}

async function beginDetection() {
  step.value = 1
  await Promise.all([detectEnvironment(), loadInstallerStatus()])
}

async function openDownload(target: EnvironmentDownloadTarget) {
  const result = await window.cppPet.environment.openDownload({ target })
  if (!result.ok) app.setError(result.error)
}

async function loadInstallerStatus() {
  const result = await window.cppPet.environment.installerStatus()
  if (result.ok) installerStatus.value = result.data
  else app.setError(result.error)
}

async function installWithWinget(target: EnvironmentInstallTarget) {
  installingTarget.value = target
  installMessage.value = ''
  const result = await window.cppPet.environment.install({ target })
  installingTarget.value = ''
  if (!result.ok) {
    app.setError(result.error)
    return
  }
  installMessage.value = result.data.launched
    ? `${installCatalog[target].label} 安装终端已打开。安装结束后回到这里重新检测。`
    : '已取消打开安装终端。'
}

async function bindSelected() {
  const candidate = selectedCandidate.value
  if (!candidate) return
  binding.value = true
  toolchainMessage.value = '正在编译并运行 Hello World…'
  const result = await window.cppPet.toolchains.bind({ candidateId: candidate.id })
  binding.value = false
  if (!result.ok) {
    app.setError(result.error)
    toolchainMessage.value = ''
    return
  }
  toolchainMessage.value = `${familyName(candidate.family)} ${result.data.version} 已验证并绑定`
  await Promise.all([loadBindings(), app.init()])
}

async function chooseWorkspace() {
  const workspace = await app.selectWorkspace()
  if (workspace) selectedWorkspaceId.value = workspace.id
}

async function trustSelectedWorkspace() {
  const workspace = selectedWorkspace.value
  if (!workspace || workspace.trustState === 'trusted') return
  const trusted = await app.trustWorkspace(workspace.id)
  if (trusted) selectedWorkspaceId.value = trusted.id
}

async function complete(destination: '/home' | '/workspace' = '/home') {
  await app.updateSettings({ onboardingCompleted: true, onboardingStatus: 'completed', onboardingReminderDismissed: false })
  await router.replace(destination)
}

async function skip() {
  await app.updateSettings({ onboardingCompleted: true, onboardingStatus: 'skipped', onboardingReminderDismissed: false })
  skipConfirming.value = false
  await router.replace('/home')
}

function previous() {
  step.value = Math.max(0, step.value - 1)
}

function familyName(family: ToolchainCandidate['family']) {
  return family === 'gcc' ? 'GCC' : family === 'clang' ? 'Clang' : 'MSVC'
}

function candidateMeta(candidate: ToolchainCandidate) {
  const parts = [candidate.capabilities.debug && candidate.debuggerPath ? '含调试器' : '仅编译']
  if (candidate.languageServerPath) parts.push('含 clangd')
  if (candidate.cmakeGenerator) parts.push(candidate.cmakeGenerator)
  return parts.join(' · ')
}
</script>

<template>
  <div class="onboarding-view">
    <aside class="onboarding-steps">
      <div class="onboarding-brand">
        <span><Code2 :size="19" /></span>
        <div><strong>环境初始化</strong><small>CppPet Setup</small></div>
      </div>
      <ol>
        <li v-for="(item, index) in steps" :key="item.title" :class="{ active: step === index, done: step > index }">
          <i><Check v-if="step > index" :size="14" /><component :is="item.icon" v-else :size="14" /></i>
          <div><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></div>
        </li>
      </ol>
      <button class="onboarding-skip" @click="skipConfirming = true">稍后配置</button>
    </aside>

    <main class="onboarding-main">
      <section v-if="step === 0" class="onboarding-stage welcome-stage">
        <p class="eyebrow">{{ isFirstRun ? '首次使用' : '环境设置' }}</p>
        <h1>把 C++ 环境准备好</h1>
        <p class="stage-lead">向导会检测已有工具、验证真实编译能力，并建立一个受保护的代码工作区。不会静默安装软件或修改系统 PATH。</p>
        <div class="setup-outline">
          <div><Gauge :size="18" /><strong>自动检测</strong><span>查找 GCC、Clang、MSVC、GDB、clangd、CMake 和 VS Code。</span></div>
          <div><Play :size="18" /><strong>真实验证</strong><span>编译并运行 Hello World，确认工具链不是只有路径而是真的可用。</span></div>
          <div><ShieldCheck :size="18" /><strong>明确授权</strong><span>代码文件只会写入你选择并信任的工作区。</span></div>
        </div>
        <footer><button class="primary-command onboarding-primary" @click="beginDetection"><Sparkles :size="16" />开始初始化</button></footer>
      </section>

      <section v-else-if="step === 1" class="onboarding-stage">
        <header class="stage-header">
          <div><p class="eyebrow">步骤 1 / 4</p><h1>检测开发环境</h1><p>扫描只读取可执行文件位置与版本，不会修改系统设置。</p></div>
          <button class="secondary-command" :disabled="detecting" @click="detectEnvironment"><RefreshCw :size="15" :class="{ spinning: detecting }" />重新检测</button>
        </header>
        <div v-if="detecting && !detection" class="setup-scanning"><RefreshCw :size="24" class="spinning" /><strong>正在扫描本机工具</strong><span>首次检测可能需要几秒钟。</span></div>
        <template v-else>
          <div class="readiness-line"><strong>{{ readyCount }} / {{ environmentRows.length }} 项已就绪</strong><span>编译器与调试器是核心项，其他工具可以后续补充。</span></div>
          <div class="environment-checklist">
            <div v-for="item in environmentRows" :key="item.label">
              <i :class="{ ready: item.ready }"><Check v-if="item.ready" :size="14" /><CircleAlert v-else :size="14" /></i>
              <div><strong>{{ item.label }}</strong><span>{{ item.detail }}</span></div>
              <button v-if="!item.ready" class="secondary-command" @click="openDownload(item.target)"><Download :size="14" />官方下载</button>
            </div>
          </div>
          <section v-if="installPlans.length" class="installer-guide">
            <header>
              <div><PackageCheck :size="18" /><span><strong>缺失组件安装方案</strong><small>可以使用 WinGet 打开可见安装终端，也可以进入官网手动安装。</small></span></div>
              <b :class="{ ready: installerStatus?.available }">{{ installerStatus?.available ? `WinGet ${installerStatus.version ?? '可用'}` : '仅官网安装' }}</b>
            </header>
            <article v-for="plan in installPlans" :key="plan.target">
              <div><strong>{{ plan.label }}</strong><span>{{ plan.detail }}</span><code v-if="plan.after">{{ plan.after }}</code></div>
              <div class="installer-actions">
                <button class="secondary-command" @click="openDownload(plan.target)"><ExternalLink :size="14" />官网</button>
                <button class="primary-command" :disabled="!installerStatus?.available || Boolean(installingTarget)" @click="installWithWinget(plan.target)">
                  <Download :size="14" />{{ installingTarget === plan.target ? '正在准备' : 'WinGet 安装' }}
                </button>
              </div>
            </article>
            <p v-if="!installerStatus?.available" class="installer-note">{{ installerStatus?.reason ?? '正在检查 WinGet…' }}</p>
            <p v-if="installMessage" class="installer-note success">{{ installMessage }}</p>
          </section>
        </template>
        <footer>
          <button class="secondary-command" @click="previous"><ArrowLeft :size="15" />上一步</button>
          <button class="primary-command" :disabled="detecting" @click="step = 2">配置工具链<ArrowRight :size="15" /></button>
        </footer>
      </section>

      <section v-else-if="step === 2" class="onboarding-stage">
        <header class="stage-header">
          <div><p class="eyebrow">步骤 2 / 4</p><h1>选择 C++ 工具链</h1><p>推荐带 GDB 的 GCC，能够使用当前完整的编译、运行和调试能力。</p></div>
        </header>
        <div v-if="activeProfile" class="bound-toolchain">
          <CheckCircle2 :size="19" />
          <div><strong>当前已绑定 {{ familyName(activeProfile.family) }} {{ activeProfile.version }}</strong><span>{{ activeProfile.compilerPath }}</span></div>
        </div>
        <div v-if="detection?.candidates.length" class="candidate-list">
          <label v-for="candidate in detection.candidates" :key="candidate.id" :class="{ selected: selectedCandidateId === candidate.id }">
            <input v-model="selectedCandidateId" type="radio" name="toolchain" :value="candidate.id" />
            <span class="toolchain-family">{{ familyName(candidate.family) }}</span>
            <div><strong>{{ candidate.version }} · {{ candidate.targetArch }}</strong><span>{{ candidate.compilerPath }}</span><small>{{ candidateMeta(candidate) }}</small></div>
            <b v-if="candidate.family === 'gcc' && candidate.debuggerPath">推荐</b>
          </label>
        </div>
        <div v-else class="missing-toolchain">
          <Terminal :size="25" />
          <strong>没有发现可用编译器</strong>
          <span>初学者推荐安装 MSYS2，然后安装 UCRT64 GCC 和 GDB。安装完成后返回上一步重新检测。</span>
          <div><button class="primary-command" @click="openDownload('msys2')"><ExternalLink :size="15" />打开 MSYS2 官网</button><button class="secondary-command" @click="openDownload('visual-studio')">Visual Studio Build Tools</button></div>
        </div>
        <p v-if="toolchainMessage" class="setup-result"><CheckCircle2 :size="15" />{{ toolchainMessage }}</p>
        <footer>
          <button class="secondary-command" @click="previous"><ArrowLeft :size="15" />上一步</button>
          <button v-if="selectedCandidate" class="secondary-command" :disabled="binding" @click="bindSelected"><Play :size="15" />{{ binding ? '正在验证' : '验证并使用' }}</button>
          <button class="primary-command" :disabled="!activeProfile" @click="step = 3">下一步<ArrowRight :size="15" /></button>
        </footer>
      </section>

      <section v-else-if="step === 3" class="onboarding-stage">
        <header class="stage-header">
          <div><p class="eyebrow">步骤 3 / 4</p><h1>选择代码工作区</h1><p>所有项目、源码和快照都限制在授权目录中，避免误操作其他文件。</p></div>
        </header>
        <div class="workspace-setup">
          <button class="workspace-picker" @click="chooseWorkspace"><FolderRoot :size="22" /><div><strong>{{ selectedWorkspace ? selectedWorkspace.name : '选择一个文件夹' }}</strong><span>{{ selectedWorkspace?.rootPath ?? '建议新建一个专门保存 C++ 练习的目录' }}</span></div><ArrowRight :size="16" /></button>
          <div v-if="selectedWorkspace" class="workspace-permission">
            <ShieldCheck :size="18" />
            <div><strong>{{ selectedWorkspace.trustState === 'trusted' ? '工作区已授权' : '当前为只读检查模式' }}</strong><span>{{ selectedWorkspace.trustState === 'trusted' ? '应用可以在该目录中创建项目、保存文件和快照。' : '确认信任后才能写入代码。' }}</span></div>
            <button v-if="selectedWorkspace.trustState !== 'trusted'" class="primary-command" @click="trustSelectedWorkspace">信任此工作区</button>
          </div>
        </div>
        <footer>
          <button class="secondary-command" @click="previous"><ArrowLeft :size="15" />上一步</button>
          <button class="primary-command" :disabled="selectedWorkspace?.trustState !== 'trusted'" @click="step = 4">完成检查<ArrowRight :size="15" /></button>
        </footer>
      </section>

      <section v-else class="onboarding-stage completion-stage">
        <span class="completion-mark"><Check :size="28" /></span>
        <p class="eyebrow">初始化完成</p>
        <h1>可以开始写 C++ 了</h1>
        <p class="stage-lead">编译器已经过真实验证，工作区也已授权。缺少的可选工具仍可在设置页继续安装和检测。</p>
        <dl class="setup-summary">
          <div><dt>工具链</dt><dd>{{ activeProfile ? `${familyName(activeProfile.family)} ${activeProfile.version}` : '稍后配置' }}</dd></div>
          <div><dt>调试</dt><dd>{{ activeProfile?.debuggerPath ? 'GDB 可用' : '暂不可用' }}</dd></div>
          <div><dt>代码智能</dt><dd>{{ hasTool('clangd') ? 'clangd 可用' : '基础编辑模式' }}</dd></div>
          <div><dt>工作区</dt><dd>{{ selectedWorkspace?.name ?? '尚未选择' }}</dd></div>
        </dl>
        <footer>
          <button class="secondary-command" @click="complete('/home')">进入首页</button>
          <button class="primary-command onboarding-primary" @click="complete('/workspace')"><Code2 :size="16" />打开工作区</button>
        </footer>
      </section>
    </main>
    <div v-if="skipConfirming" class="onboarding-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="skip-title">
      <section class="onboarding-confirm">
        <CircleAlert :size="22" />
        <div>
          <h2 id="skip-title">暂时跳过环境配置？</h2>
          <p>你仍然可以进入首页，但编译、运行和调试功能可能暂不可用。</p>
          <strong>之后可从“左侧活动栏 → 设置 → C++ 工具链 → 环境向导”再次打开。</strong>
        </div>
        <footer>
          <button class="secondary-command" @click="skipConfirming = false">继续配置</button>
          <button class="primary-command" @click="skip">确认稍后配置</button>
        </footer>
      </section>
    </div>
  </div>
</template>
