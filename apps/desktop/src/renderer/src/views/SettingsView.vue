<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bot, CheckCircle2, Database, FolderRoot, KeyRound, MonitorCog, Moon, Play, Plus, RefreshCw, Save, Sparkles, Sun, Trash2, Wifi, WifiOff, Wrench } from 'lucide-vue-next'
import type {
  CursorStyle,
  ToolchainBindingState,
  ToolchainCandidate,
  ToolchainDetectionResult,
  ToolchainProbeResult
} from '@cpp-pet/contracts'
import { useAppStore } from '../stores/app'
import { useAgentStore } from '../stores/agent'
import classicPreview from '../assets/cursor-classic.png'
import mascotPreview from '../assets/cursor-mascot.png'

const app = useAppStore()
const agent = useAgentStore()
const route = useRoute()
const router = useRouter()
const detection = ref<ToolchainDetectionResult | null>(null)
const bindings = ref<ToolchainBindingState>({ profiles: [] })
const probes = ref<Record<string, ToolchainProbeResult>>({})
const detecting = ref(false)
const activeAction = ref('')
const modelAction = ref('')
const modelNotice = ref('')
const activeSection = ref('appearance')
const scrollRoot = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let ignoreObserverUntil = 0

const sections = [
  { id: 'appearance', label: '外观', hint: '主题与光标', icon: Sun },
  { id: 'toolchains', label: 'C++ 工具链', hint: '检测与绑定', icon: Wrench },
  { id: 'workspace', label: '工作区', hint: '授权目录', icon: FolderRoot },
  { id: 'models', label: '模型服务', hint: 'BYOK 与离线', icon: Bot },
  { id: 'data', label: '本地数据', hint: '数据库状态', icon: Database }
] as const

const sectionIds = new Set(sections.map(item => item.id))
const activeProfile = computed(() => bindings.value.profiles.find(item => item.id === bindings.value.activeProfileId))
const modelForm = reactive({ id: '', name: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', model: '', timeoutMs: 30_000, enabled: true, apiKey: '' })
const selectedModelId = ref('')
const selectedModel = computed(() => agent.models.find(item => item.id === selectedModelId.value))
const offlineMode = computed(() => !agent.models.some(item => item.enabled && item.apiKeyConfigured))

const cursorOptions: Array<{ id: CursorStyle; title: string; detail: string; preview?: string }> = [
  { id: 'mascot', title: '桌宠光标', detail: '默认 · 猫猫 + 箭头', preview: mascotPreview },
  { id: 'classic', title: '经典箭头', detail: '代码风格指针', preview: classicPreview },
  { id: 'system', title: '系统光标', detail: '跟随操作系统' }
]

function resolveTargetSection(): string | null {
  const fromQuery = typeof route.query.section === 'string' ? route.query.section : ''
  if (sectionIds.has(fromQuery as typeof sections[number]['id'])) return fromQuery
  const fromHash = (route.hash || '').replace(/^#/, '')
  if (sectionIds.has(fromHash as typeof sections[number]['id'])) return fromHash
  return null
}

onMounted(async () => {
  await Promise.all([loadBindings(), loadModels()])
  await nextTick()
  setupSectionObserver()
  const target = resolveTargetSection()
  if (target) await jumpToSection(target, false)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

watch(
  () => [route.query.section, route.hash] as const,
  async () => {
    const target = resolveTargetSection()
    if (target && target !== activeSection.value) await jumpToSection(target, false)
  }
)

function setupSectionObserver() {
  observer?.disconnect()
  const root = scrollRoot.value
  if (!root) return
  observer = new IntersectionObserver(entries => {
    if (Date.now() < ignoreObserverUntil) return
    const visible = entries
      .filter(item => item.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
    const top = visible[0]?.target
    if (top?.id) activeSection.value = top.id
  }, { root, rootMargin: '-18% 0px -62% 0px', threshold: [0.12, 0.3, 0.55] })
  for (const section of sections) {
    const el = root.querySelector(`#${section.id}`)
    if (el) observer.observe(el)
  }
}

async function jumpToSection(id: string, updateUrl = true) {
  if (!sectionIds.has(id as typeof sections[number]['id'])) return
  const root = scrollRoot.value
  const target = root?.querySelector<HTMLElement>(`#${id}`)
  if (!target || !root) return
  activeSection.value = id
  // 程序化滚动期间暂时忽略 IntersectionObserver，避免顶部目录被“外观”抢回
  ignoreObserverUntil = Date.now() + 700
  await nextTick()
  const rootPaddingTop = Number.parseFloat(getComputedStyle(root).paddingTop) || 0
  const stickyOffset = rootPaddingTop + (root.querySelector<HTMLElement>('.settings-jumpbar')?.getBoundingClientRect().height ?? 60) + 12
  const top = root.scrollTop + (target.getBoundingClientRect().top - root.getBoundingClientRect().top) - stickyOffset
  root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  if (updateUrl) {
    await router.replace({ path: '/settings', query: { section: id } })
  }
}

async function loadBindings() {
  const result = await window.cppPet.toolchains.list()
  if (result.ok) bindings.value = result.data
  else app.setError(result.error)
}

async function loadModels() {
  await agent.refreshModels()
  if (!selectedModelId.value && agent.models[0]) selectModel(agent.models[0].id)
}

function selectModel(profileId: string) {
  const profile = agent.models.find(item => item.id === profileId)
  if (!profile) return
  selectedModelId.value = profile.id
  Object.assign(modelForm, {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    timeoutMs: profile.timeoutMs,
    enabled: profile.enabled,
    apiKey: ''
  })
  modelNotice.value = ''
}

function newModel() {
  selectedModelId.value = ''
  Object.assign(modelForm, { id: '', name: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', model: '', timeoutMs: 30_000, enabled: true, apiKey: '' })
  modelNotice.value = ''
}

async function saveModel() {
  modelAction.value = 'save'
  modelNotice.value = ''
  const saved = await agent.saveModel({
    ...(modelForm.id ? { id: modelForm.id } : {}),
    name: modelForm.name.trim(),
    baseUrl: modelForm.baseUrl.trim(),
    model: modelForm.model.trim(),
    timeoutMs: Number(modelForm.timeoutMs),
    enabled: modelForm.enabled,
    ...(modelForm.apiKey.trim() ? { apiKey: modelForm.apiKey.trim() } : {})
  })
  modelAction.value = ''
  if (!saved) return
  modelForm.apiKey = ''
  selectedModelId.value = saved.id
  modelForm.id = saved.id
  modelNotice.value = '模型配置已保存。'
}

async function clearModelKey() {
  if (!modelForm.id) return
  modelAction.value = 'clear'
  const profile = await agent.clearModelKey(modelForm.id)
  modelAction.value = ''
  if (profile) modelNotice.value = 'API Key 已清除。'
}

async function testModel() {
  if (!modelForm.id) return
  modelAction.value = 'test'
  modelNotice.value = ''
  const result = await agent.testModel(modelForm.id)
  modelAction.value = ''
  if (result) modelNotice.value = `连接成功 · ${result.latencyMs} ms`
}

async function removeModel() {
  if (!modelForm.id) return
  modelAction.value = 'remove'
  const removed = await agent.removeModel(modelForm.id)
  modelAction.value = ''
  if (!removed) return
  newModel()
  if (agent.models[0]) selectModel(agent.models[0].id)
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

async function selectCursor(style: CursorStyle) {
  await app.updateSettings({ cursorStyle: style })
}
</script>

<template>
  <div ref="scrollRoot" class="settings-view page-scroll">
    <section class="page-header settings-page-header">
      <div>
        <p class="eyebrow">应用设置</p>
        <h1>偏好与开发环境</h1>
        <p>主题、光标、工具链与工作区都在这一页。下方目录用于快速跳转到对应模块。</p>
      </div>
    </section>

    <nav class="settings-jumpbar" aria-label="设置模块快速跳转">
      <div class="settings-jumpbar-label">
        <strong>本页目录</strong>
        <span>点击跳转到模块</span>
      </div>
      <div class="settings-jumpbar-list">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :class="['settings-jump-item', { active: activeSection === item.id }]"
          :title="`跳转到${item.label}`"
          @click="jumpToSection(item.id)"
        >
          <component :is="item.icon" :size="15" />
          <span>
            <b>{{ item.label }}</b>
            <small>{{ item.hint }}</small>
          </span>
        </button>
      </div>
    </nav>

    <div class="settings-content">
      <section id="appearance" class="settings-section">
        <header>
          <Sun :size="18" />
          <div>
            <h2>外观</h2>
            <p>主题与鼠标光标等界面偏好。</p>
          </div>
        </header>
        <div class="setting-row">
          <span>主题</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.theme === 'system' }" @click="app.updateSettings({ theme: 'system' })"><MonitorCog :size="15" />系统</button>
            <button :class="{ active: app.settings.theme === 'light' }" @click="app.updateSettings({ theme: 'light' })"><Sun :size="15" />浅色</button>
            <button :class="{ active: app.settings.theme === 'dark' }" @click="app.updateSettings({ theme: 'dark' })"><Moon :size="15" />深色</button>
          </div>
        </div>
        <div class="setting-block">
          <div class="setting-copy">
            <span>鼠标光标</span>
            <small>在卡片上悬停可预览真实指针效果，点击即可切换并保存。</small>
          </div>
          <div class="cursor-option-grid">
            <button
              v-for="option in cursorOptions"
              :key="option.id"
              type="button"
              :class="['cursor-option', `preview-${option.id}`, { active: (app.settings.cursorStyle ?? 'mascot') === option.id }]"
              @click="selectCursor(option.id)"
            >
              <div class="cursor-option-preview">
                <img v-if="option.preview" :src="option.preview" :alt="option.title" />
                <span v-else class="cursor-option-system">系统</span>
              </div>
              <div class="cursor-option-meta">
                <strong>{{ option.title }}</strong>
                <small>{{ option.detail }}</small>
              </div>
            </button>
          </div>
        </div>
      </section>

      <section id="toolchains" class="settings-section">
        <header>
          <Wrench :size="18" />
          <div>
            <h2>C++ 工具链</h2>
            <p>检测本机编译器，通过 Hello World 验证后绑定。</p>
          </div>
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
        <header>
          <FolderRoot :size="18" />
          <div>
            <h2>授权工作区</h2>
            <p>只有明确授权的 Root 才能被应用写入。</p>
          </div>
        </header>
        <div v-for="item in app.workspaces" :key="item.id" class="workspace-setting">
          <div><strong>{{ item.name }}</strong><span>{{ item.rootPath }}</span></div>
          <b :class="item.trustState">{{ item.trustState === 'trusted' ? '已信任' : item.trustState === 'inspection' ? '只读检查' : '已撤销' }}</b>
        </div>
        <button class="secondary-command" @click="app.selectWorkspace">添加工作区</button>
      </section>

      <section id="models" class="settings-section model-settings-section">
        <header>
          <Bot :size="18" />
          <div>
            <h2>模型服务</h2>
            <p>OpenAI-compatible BYOK；未配置时使用确定性离线规划。</p>
          </div>
          <div class="section-actions model-profile-actions">
            <select v-model="selectedModelId" aria-label="模型配置" @change="selectModel(selectedModelId)">
              <option value="">新配置</option>
              <option v-for="profile in agent.models" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
            </select>
            <button class="icon-command" title="新建模型配置" @click="newModel"><Plus :size="15" /></button>
          </div>
        </header>
        <div :class="['model-mode-line', { offline: offlineMode }]">
          <component :is="offlineMode ? WifiOff : Wifi" :size="17" />
          <div><strong>{{ offlineMode ? '离线规划模式' : '在线模型可用' }}</strong><span>{{ offlineMode ? '七条工作流仍调用本地工具并保留验证证据。' : `${selectedModel?.name ?? '已启用配置'} · 密钥已保护` }}</span></div>
        </div>
        <div class="model-field-grid">
          <label><span>配置名称</span><input v-model="modelForm.name" maxlength="100" /></label>
          <label><span>模型名称</span><input v-model="modelForm.model" maxlength="200" placeholder="例如 gpt-4.1-mini" /></label>
          <label class="wide"><span>Base URL</span><input v-model="modelForm.baseUrl" type="url" maxlength="2048" /></label>
          <label><span>超时</span><input v-model.number="modelForm.timeoutMs" type="number" min="1000" max="120000" step="1000" /><small>毫秒</small></label>
          <label class="model-toggle"><input v-model="modelForm.enabled" type="checkbox" /><span>启用此配置</span></label>
          <label class="wide model-key-field"><span>API Key</span><div><KeyRound :size="15" /><input v-model="modelForm.apiKey" type="password" maxlength="10000" autocomplete="new-password" :placeholder="selectedModel?.apiKeyConfigured ? '已安全保存；留空保持不变' : '输入新密钥'" /></div></label>
        </div>
        <footer class="model-actions">
          <span :class="{ success: modelNotice.startsWith('连接成功') || modelNotice.includes('已保存') }">{{ modelNotice }}</span>
          <button v-if="modelForm.id" class="icon-command danger" title="删除模型配置" :disabled="Boolean(modelAction)" @click="removeModel"><Trash2 :size="15" /></button>
          <button class="secondary-command" :disabled="!modelForm.id || !selectedModel?.apiKeyConfigured || Boolean(modelAction)" @click="clearModelKey"><KeyRound :size="14" />清除密钥</button>
          <button class="secondary-command" :disabled="!modelForm.id || !selectedModel?.apiKeyConfigured || Boolean(modelAction)" @click="testModel"><Wifi :size="14" />{{ modelAction === 'test' ? '测试中' : '测试连接' }}</button>
          <button class="primary-command" :disabled="!modelForm.name.trim() || !modelForm.model.trim() || !modelForm.baseUrl.trim() || Boolean(modelAction)" @click="saveModel"><Save :size="14" />{{ modelAction === 'save' ? '保存中' : '保存配置' }}</button>
        </footer>
      </section>

      <section id="data" class="settings-section">
        <header>
          <Database :size="18" />
          <div>
            <h2>本地数据</h2>
            <p>SQLite、快照和日志保存在当前 Windows 用户数据目录。</p>
          </div>
        </header>
        <div class="data-status">
          <i class="status-dot" />
          <span>数据库与 WAL 正常</span>
          <small>迁移前自动备份，失败时进入只读恢复模式</small>
        </div>
      </section>
    </div>
  </div>
</template>
