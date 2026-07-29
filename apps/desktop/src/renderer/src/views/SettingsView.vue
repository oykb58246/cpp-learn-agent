<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Bot, CheckCircle2, Database, FolderRoot, Hand, ImagePlus, KeyRound, MonitorCog, Moon, MousePointer2, Play, Plus, RefreshCw, Save, Shield, Sparkles, Sun, Trash2, Wifi, WifiOff, Wrench } from 'lucide-vue-next'
import type {
  CursorStyle,
  PetAssetMode,
  PetCustomAsset,
  PetWindowState,
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
const workspaceAction = ref('')
const newCustomPetAssetName = ref('')
const activeSection = ref('appearance')

const sections = [
  { id: 'appearance', label: '外观', hint: '主题与光标', icon: Sun },
  { id: 'pet', label: '桌宠', hint: '素材与交互', icon: MousePointer2 },
  { id: 'toolchains', label: 'C++ 工具链', hint: '检测与绑定', icon: Wrench },
  { id: 'workspace', label: '工作区', hint: '授权目录', icon: FolderRoot },
  { id: 'agent', label: 'Agent 权限', hint: '操作审批策略', icon: Shield },
  { id: 'models', label: '模型服务', hint: 'BYOK 与离线', icon: Bot },
  { id: 'data', label: '本地数据', hint: '数据库状态', icon: Database }
] as const

const sectionIds = new Set(sections.map(item => item.id))
type SectionId = typeof sections[number]['id']
const activeProfile = computed(() => bindings.value.profiles.find(item => item.id === bindings.value.activeProfileId))
const defaultCapabilities = () => ({ text: true, vision: false, toolCalling: true, structuredOutput: true })
const modelForm = reactive({
  id: '',
  name: 'OpenAI',
  provider: 'openai' as 'openai' | 'deepseek' | 'custom',
  protocol: 'openai-responses' as 'auto' | 'openai-responses' | 'openai-chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  capabilities: defaultCapabilities(),
  timeoutMs: 30_000,
  enabled: true,
  apiKey: ''
})
const selectedModelId = ref('')
const selectedModel = computed(() => agent.models.find(item => item.id === selectedModelId.value))
const offlineMode = computed(() => !agent.models.some(item => item.enabled && item.apiKeyConfigured))
const effectiveProtocol = computed(() => modelForm.protocol === 'auto'
  ? modelForm.provider === 'deepseek' ? 'openai-chat-completions' : 'openai-responses'
  : modelForm.protocol)
const modelEndpointPreview = computed(() => {
  const base = modelForm.baseUrl.trim().replace(/\/$/, '')
  if (!base) return '请先填写 Base URL'
  if (effectiveProtocol.value === 'openai-responses') return `${base}/responses`
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
})
const modelProtocolLabel = computed(() => effectiveProtocol.value === 'openai-responses'
  ? 'OpenAI Responses API'
  : 'OpenAI Chat Completions')
const petTimedHideActive = computed(() => {
  const value = app.settings.pet.hiddenUntil
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time > Date.now()
})
const hiddenUntilText = computed(() => {
  if (!petTimedHideActive.value || !app.settings.pet.hiddenUntil) return '当前未启用限时隐藏'
  return `隐藏至 ${new Date(app.settings.pet.hiddenUntil).toLocaleString()}`
})

const cursorOptions: Array<{ id: CursorStyle; title: string; detail: string; preview?: string }> = [
  { id: 'mascot', title: '猫猫指针', detail: '默认 · 猫猫 + 箭头', preview: mascotPreview },
  { id: 'classic', title: '经典箭头', detail: '代码风格指针', preview: classicPreview },
  { id: 'system', title: '系统光标', detail: '跟随操作系统' }
]

type PetAssetListItem =
  | { id: PetAssetMode; kind: 'built-in'; title: string; detail: string; mode: Exclude<PetAssetMode, 'custom'> }
  | { id: string; kind: 'custom'; title: string; detail: string; asset: PetCustomAsset }

const builtInPetAssets: PetAssetListItem[] = [
  { id: 'cpppilot-logo', kind: 'built-in', mode: 'cpppilot-logo', title: 'CppPilot Logo', detail: '内置品牌桌宠，适合作为默认形象。' },
  { id: 'salary-cat', kind: 'built-in', mode: 'salary-cat', title: 'Salary Cat', detail: '内置 cat.GIF 动画桌宠。' }
]
function resolveTargetSection(): string | null {
  const fromQuery = typeof route.query.section === 'string' ? route.query.section : ''
  if (sectionIds.has(fromQuery as typeof sections[number]['id'])) return fromQuery
  const fromHash = (route.hash || '').replace(/^#/, '')
  if (sectionIds.has(fromHash as typeof sections[number]['id'])) return fromHash
  return null
}

let stopPetState: (() => void) | undefined

onMounted(async () => {
  await Promise.all([loadBindings(), loadModels()])
  // 与桌宠右键/托盘设置实时同步
  stopPetState = window.cppPet.pet.onStateChanged(state => applyPetState(state))
  const petState = await window.cppPet.pet.getState()
  if (petState.ok) applyPetState(petState.data)
  const target = resolveTargetSection()
  if (target) activeSection.value = target
})

async function setWorkspaceTrust(workspaceId: string, trusted: boolean) {
  workspaceAction.value = workspaceId
  await app.setWorkspaceTrust(workspaceId, trusted)
  workspaceAction.value = ''
}

onBeforeUnmount(() => {
  stopPetState?.()
})

watch(
  () => [route.query.section, route.hash] as const,
  async () => {
    const target = resolveTargetSection()
    if (target && target !== activeSection.value) activeSection.value = target
  }
)

async function jumpToSection(id: string, updateUrl = true) {
  if (!sectionIds.has(id as SectionId)) return
  activeSection.value = id
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
    provider: profile.provider,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    capabilities: { ...profile.capabilities },
    timeoutMs: profile.timeoutMs,
    enabled: profile.enabled,
    apiKey: ''
  })
  modelNotice.value = ''
}

function newModel() {
  selectedModelId.value = ''
  Object.assign(modelForm, {
    id: '',
    name: 'OpenAI',
    provider: 'openai',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    capabilities: defaultCapabilities(),
    timeoutMs: 30_000,
    enabled: true,
    apiKey: ''
  })
  modelNotice.value = ''
}

function applyProviderPreset() {
  if (modelForm.provider === 'openai') {
    modelForm.name = modelForm.id ? modelForm.name : 'OpenAI'
    modelForm.baseUrl = 'https://api.openai.com/v1'
    modelForm.protocol = 'openai-responses'
    return
  }
  if (modelForm.provider === 'deepseek') {
    modelForm.name = modelForm.id ? modelForm.name : 'DeepSeek'
    modelForm.baseUrl = 'https://api.deepseek.com'
    modelForm.protocol = 'openai-chat-completions'
    modelForm.capabilities.vision = false
    return
  }
  modelForm.protocol = 'auto'
}

async function saveModel() {
  modelAction.value = 'save'
  modelNotice.value = ''
  const saved = await agent.saveModel({
    ...(modelForm.id ? { id: modelForm.id } : {}),
    name: modelForm.name.trim(),
    provider: modelForm.provider,
    protocol: modelForm.protocol,
    baseUrl: modelForm.baseUrl.trim(),
    model: modelForm.model.trim(),
    capabilities: { ...modelForm.capabilities },
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
  if (result) {
    const protocol = result.protocol === 'openai-responses' ? 'Responses' : 'Chat Completions'
    modelNotice.value = `连接成功 · ${protocol} · ${result.latencyMs} ms`
  }
}

async function testModelVision() {
  if (!modelForm.id) return
  modelAction.value = 'vision'
  modelNotice.value = '正在发送一张极小的红色测试图片…'
  const result = await agent.testModelVision(modelForm.id)
  modelAction.value = ''
  if (!result) return
  if (result.supported) {
    modelForm.capabilities.vision = true
    modelNotice.value = `图片输入可用 · ${result.latencyMs} ms，已启用图片理解`
  } else {
    modelForm.capabilities.vision = false
    modelNotice.value = `图片输入不可用 · ${result.detail}`
  }
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

const customPetAssets = computed(() => app.settings.pet.customAssets ?? [])
const activeCustomAssetId = computed(() => app.settings.pet.activeCustomAssetId ?? '')
const petAssetList = computed<PetAssetListItem[]>(() => [
  ...builtInPetAssets,
  ...customPetAssets.value.map(asset => ({
    id: asset.id,
    kind: 'custom' as const,
    title: asset.name,
    detail: `${customAssetFileName(asset)} · ${asset.mime}`,
    asset
  }))
])

function applyPetState(next: PetWindowState) {
  app.applyPetWindowState(next)
}

async function updatePetSettings(patch: Partial<typeof app.settings.pet>) {
  activeAction.value = 'pet:update'
  // 先乐观更新本地，避免 UI 闪回默认形象
  const previous = { ...app.settings.pet }
  if (app.bootstrap) {
    app.bootstrap.settings = {
      ...app.bootstrap.settings,
      pet: {
        ...previous,
        ...patch,
        assetMode: patch.assetMode ?? previous.assetMode,
        customAssets: Object.prototype.hasOwnProperty.call(patch, 'customAssets')
          ? (patch.customAssets ?? [])
          : previous.customAssets
      }
    }
  }
  const result = await window.cppPet.pet.updateSettings(patch)
  if (result.ok) applyPetState(result.data)
  else {
    if (app.bootstrap) app.bootstrap.settings = { ...app.bootstrap.settings, pet: previous }
    app.setError(result.error)
  }
  activeAction.value = ''
}


async function selectCustomPetAsset() {
  const name = newCustomPetAssetName.value.trim()
  if (!name) return
  activeAction.value = 'pet:asset:create'
  const result = await window.cppPet.pet.selectCustomAsset({ name })
  if (result.ok) {
    applyPetState(result.data)
    newCustomPetAssetName.value = ''
  } else app.setError(result.error)
  activeAction.value = ''
}

async function resetCustomPetAsset() {
  activeAction.value = 'pet:asset'
  const result = await window.cppPet.pet.resetCustomAsset()
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function activateCustomPetAsset(assetId: string) {
  activeAction.value = `pet:asset:${assetId}`
  const result = await window.cppPet.pet.activateCustomAsset({ assetId })
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function renameCustomPetAsset(asset: PetCustomAsset, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name || name === asset.name) return
  activeAction.value = `pet:asset:${asset.id}`
  const result = await window.cppPet.pet.renameCustomAsset({ assetId: asset.id, name })
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function deleteCustomPetAsset(assetId: string) {
  activeAction.value = `pet:asset:${assetId}`
  const result = await window.cppPet.pet.deleteCustomAsset({ assetId })
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

function customAssetFileName(asset: PetCustomAsset) {
  return asset.path.split(/[\\/]/).pop() ?? asset.name
}

function customAssetActive(asset: PetCustomAsset) {
  return app.settings.pet.assetMode === 'custom' && activeCustomAssetId.value === asset.id
}

function petAssetActive(item: PetAssetListItem) {
  return item.kind === 'built-in'
    ? app.settings.pet.assetMode === item.mode
    : customAssetActive(item.asset)
}

async function activatePetAsset(item: PetAssetListItem) {
  if (item.kind === 'built-in') await updatePetSettings({ assetMode: item.mode, activeCustomAssetId: undefined })
  else await activateCustomPetAsset(item.asset.id)
}

async function hidePetForOneHour() {
  activeAction.value = 'pet:update'
  const result = await window.cppPet.pet.hideForOneHour()
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function cancelTimedPetHide() {
  activeAction.value = 'pet:update'
  const result = await window.cppPet.pet.cancelHidden()
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function toggleFocusMode(enabled: boolean) {
  activeAction.value = 'pet:update'
  const result = await window.cppPet.pet.toggleFocusMode({ enabled })
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}

async function toggleLaunchAtLogin(enabled: boolean) {
  activeAction.value = 'pet:update'
  const result = await window.cppPet.pet.toggleLaunchAtLogin({ enabled })
  if (result.ok) applyPetState(result.data)
  else app.setError(result.error)
  activeAction.value = ''
}
function changePetScale(event: Event) {
  const target = event.target as HTMLInputElement
  const scale = Number(target.value)
  if (Number.isFinite(scale)) void updatePetSettings({ scale })
}
</script>

<template>
  <div class="settings-view page-scroll">
    <section class="page-header settings-page-header">
      <div>
        <p class="eyebrow">应用设置</p>
        <h1>偏好与开发环境</h1>
        <p>按模块管理外观、桌宠、开发环境、Agent 与模型服务。</p>
      </div>
    </section>

    <div class="settings-module-layout">
      <nav class="settings-module-nav" aria-label="设置模块">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :class="['settings-module-item', { active: activeSection === item.id }]"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="jumpToSection(item.id)"
        >
          <component :is="item.icon" :size="15" />
          <span>
            <b>{{ item.label }}</b>
            <small>{{ item.hint }}</small>
          </span>
        </button>
      </nav>

      <div class="settings-content">
      <section v-show="activeSection === 'appearance'" id="appearance" class="settings-section">
        <header>
          <Sun :size="18" />
          <div>
            <h2>外观</h2>
            <p>主题与鼠标指针等界面偏好。</p>
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
            <span>鼠标指针</span>
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

      <section v-show="activeSection === 'pet'" id="pet" class="settings-section">
        <header>
          <MousePointer2 :size="18" />
          <div>
            <h2>桌宠</h2>
            <p>控制透明桌宠窗口、素材列表、通关进度条、状态气泡和鼠标穿透。</p>
          </div>
        </header>
        <div class="setting-row">
          <span>显示桌宠</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.visible }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ visible: true })">显示</button>
            <button :class="{ active: !app.settings.pet.visible }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ visible: false })">隐藏</button>
          </div>
        </div>
        <div class="setting-block">
          <div class="setting-copy">
            <span>桌宠素材列表</span>
            <small>内置素材和你创建的本地素材都在这里；自定义素材会保存在本机并可继续命名、启用或删除。</small>
          </div>
          <div class="pet-create-row">
            <label>
              <span>自定义素材库</span>
              <input v-model="newCustomPetAssetName" maxlength="120" placeholder="给新桌宠命名" @keyup.enter="selectCustomPetAsset" />
            </label>
            <small>{{ customPetAssets.length ? `${customPetAssets.length} 个本地素材` : '未上传' }}</small>
            <button class="secondary-command" :disabled="activeAction === 'pet:asset:create' || !newCustomPetAssetName.trim()" @click="selectCustomPetAsset"><ImagePlus :size="14" />创建桌宠</button>
            <button class="secondary-command" :disabled="activeAction === 'pet:update' || app.settings.pet.assetMode === 'cpppilot-logo'" @click="resetCustomPetAsset"><RefreshCw :size="14" />切回 Logo</button>
          </div>
          <div class="pet-custom-asset-list pet-asset-library">
            <div v-for="item in petAssetList" :key="item.id" :class="['pet-custom-asset-row', { active: petAssetActive(item) }]">
              <div class="pet-custom-asset-main">
                <strong v-if="item.kind === 'built-in'">{{ item.title }}</strong>
                <input v-else :value="item.asset.name" maxlength="120" :disabled="activeAction === `pet:asset:${item.asset.id}`" aria-label="自定义素材名称" @change="renameCustomPetAsset(item.asset, $event)" />
                <small>{{ item.detail }}</small>
              </div>
              <button class="secondary-command" :disabled="activeAction === `pet:asset:${item.id}` || activeAction === 'pet:update'" @click="activatePetAsset(item)"><CheckCircle2 :size="14" />{{ petAssetActive(item) ? '使用中' : '使用' }}</button>
              <button v-if="item.kind === 'custom'" class="icon-command danger" title="删除自定义素材" :disabled="activeAction === `pet:asset:${item.asset.id}`" @click="deleteCustomPetAsset(item.asset.id)"><Trash2 :size="15" /></button>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <span>隐藏一小时</span>
            <small>{{ hiddenUntilText }}</small>
          </div>
          <div class="segmented compact">
            <button
              type="button"
              :class="{ active: petTimedHideActive }"
              :disabled="activeAction === 'pet:update' || petTimedHideActive"
              @click="hidePetForOneHour"
            >隐藏 1 小时</button>
            <button
              type="button"
              :class="{ active: !petTimedHideActive }"
              :disabled="activeAction === 'pet:update' || !petTimedHideActive"
              @click="cancelTimedPetHide"
            >恢复显示</button>
          </div>
        </div>
        <div class="setting-row">
          <span>状态气泡</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.bubbleEnabled !== false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ bubbleEnabled: true })">显示</button>
            <button :class="{ active: app.settings.pet.bubbleEnabled === false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ bubbleEnabled: false })">隐藏</button>
          </div>
        </div>
        <div class="setting-row">
          <span>旋转装饰框</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.frameEnabled !== false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ frameEnabled: true })">开启</button>
            <button :class="{ active: app.settings.pet.frameEnabled === false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ frameEnabled: false })">关闭</button>
          </div>
        </div>
        <div class="setting-row">
          <span>等级进度条</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.progressBarEnabled !== false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ progressBarEnabled: true })">显示</button>
            <button :class="{ active: app.settings.pet.progressBarEnabled === false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ progressBarEnabled: false })">隐藏</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <span>边缘吸附缩小</span>
            <small>拖到屏幕边缘自动缩成小图标，单击还原。</small>
          </div>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.edgeDockEnabled !== false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ edgeDockEnabled: true })">开启</button>
            <button :class="{ active: app.settings.pet.edgeDockEnabled === false }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ edgeDockEnabled: false, docked: false })">关闭</button>
          </div>
        </div>
        <div class="setting-row">
          <span>专注模式</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.focusModeEnabled }" :disabled="activeAction === 'pet:update'" @click="toggleFocusMode(true)">开启</button>
            <button :class="{ active: !app.settings.pet.focusModeEnabled }" :disabled="activeAction === 'pet:update'" @click="toggleFocusMode(false)">关闭</button>
          </div>
        </div>
        <div class="setting-row">
          <span>开机启动</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.launchAtLogin }" :disabled="activeAction === 'pet:update'" @click="toggleLaunchAtLogin(true)">开启</button>
            <button :class="{ active: !app.settings.pet.launchAtLogin }" :disabled="activeAction === 'pet:update'" @click="toggleLaunchAtLogin(false)">关闭</button>
          </div>
        </div>
        <div class="setting-row pet-scale-row">
          <span>缩放</span>
          <label>
            <input type="range" min="0.5" max="2" step="0.1" :value="app.settings.pet.scale" :disabled="activeAction === 'pet:update'" @change="changePetScale" />
            <small>{{ Math.round(app.settings.pet.scale * 100) }}%</small>
          </label>
        </div>
        <div class="setting-row">
          <span>状态气泡</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.bubbleEnabled }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ bubbleEnabled: true })">开启</button>
            <button :class="{ active: !app.settings.pet.bubbleEnabled }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ bubbleEnabled: false })">关闭</button>
          </div>
        </div>
        <div class="setting-row">
          <span>鼠标穿透</span>
          <div class="segmented compact">
            <button :class="{ active: app.settings.pet.ignoreMouseEvents }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ ignoreMouseEvents: true })">穿透</button>
            <button :class="{ active: !app.settings.pet.ignoreMouseEvents }" :disabled="activeAction === 'pet:update'" @click="updatePetSettings({ ignoreMouseEvents: false })">交互</button>
          </div>
        </div>
      </section>

      <section v-show="activeSection === 'toolchains'" id="toolchains" class="settings-section">
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

      <section v-show="activeSection === 'workspace'" id="workspace" class="settings-section">
        <header>
          <FolderRoot :size="18" />
          <div>
            <h2>授权工作区</h2>
            <p>只有明确授权的 Root 才能被应用写入。</p>
          </div>
        </header>
        <div v-for="item in app.workspaces" :key="item.id" class="workspace-setting">
          <div class="workspace-setting-copy"><strong>{{ item.name }}</strong><span>{{ item.rootPath }}</span></div>
          <div class="workspace-setting-actions">
            <b :class="item.trustState">{{ item.trustState === 'trusted' ? '已信任' : item.trustState === 'inspection' ? '只读检查' : '已撤销' }}</b>
            <button
              v-if="item.trustState !== 'trusted'"
              class="primary-command"
              :disabled="workspaceAction === item.id"
              @click="setWorkspaceTrust(item.id, true)"
            >
              <CheckCircle2 :size="14" />{{ workspaceAction === item.id ? '授权中' : '信任' }}
            </button>
            <button
              v-else
              class="secondary-command"
              :disabled="workspaceAction === item.id"
              @click="setWorkspaceTrust(item.id, false)"
            >
              <Shield :size="14" />{{ workspaceAction === item.id ? '处理中' : '撤销' }}
            </button>
          </div>
        </div>
        <button class="secondary-command" @click="app.selectWorkspace">添加工作区</button>
      </section>


      <section v-show="activeSection === 'agent'" id="agent" class="settings-section">
        <header>
          <Shield :size="18" />
          <div>
            <h2>Agent 权限</h2>
            <p>控制 Agent 在调用模型与执行本地操作时是否需要你确认。</p>
          </div>
        </header>

        <div class="approval-mode-list" role="radiogroup" aria-label="Agent 审批模式">
          <button
            type="button"
            role="radio"
            class="approval-mode-card"
            :class="{ active: (app.settings.agentApprovalMode ?? 'on-risk') === 'always' }"
            :aria-checked="(app.settings.agentApprovalMode ?? 'on-risk') === 'always'"
            @click="app.updateSettings({ agentApprovalMode: 'always' })"
          >
            <Hand :size="18" />
            <div>
              <strong>请求批准</strong>
              <span>每次发送模型上下文、修改文件、编译运行前都会询问。</span>
            </div>
          </button>
          <button
            type="button"
            role="radio"
            class="approval-mode-card"
            :class="{ active: (app.settings.agentApprovalMode ?? 'on-risk') === 'on-risk' }"
            :aria-checked="(app.settings.agentApprovalMode ?? 'on-risk') === 'on-risk'"
            @click="app.updateSettings({ agentApprovalMode: 'on-risk' })"
          >
            <AlertTriangle :size="18" />
            <div>
              <strong>替我审批</strong>
              <span>仅对发送上下文与高风险操作（写文件/补丁等）请求批准；只读查询自动执行。</span>
            </div>
          </button>
          <button
            type="button"
            role="radio"
            class="approval-mode-card warn"
            :class="{ active: (app.settings.agentApprovalMode ?? 'on-risk') === 'full' }"
            :aria-checked="(app.settings.agentApprovalMode ?? 'on-risk') === 'full'"
            @click="app.updateSettings({ agentApprovalMode: 'full' })"
          >
            <Shield :size="18" />
            <div>
              <strong>完全访问权限</strong>
              <span>自动执行模型调用与本地工具，不再弹出审批。请仅在信任当前环境时使用。</span>
            </div>
          </button>
        </div>
        <p class="settings-footnote">默认「替我审批」。完全访问会跳过上下文发送与写操作确认。</p>
      </section>
      <section v-show="activeSection === 'models'" id="models" class="settings-section model-settings-section">
        <header>
          <Bot :size="18" />
          <div>
            <h2>模型服务</h2>
            <p>配置 OpenAI 或兼容服务，并明确声明协议与模型能力。</p>
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
          <div>
            <strong>{{ offlineMode ? 'Agent 模型未配置' : `${modelProtocolLabel} 可用` }}</strong>
            <span>{{ offlineMode ? '保存并启用模型配置与 API Key 后才能执行 Agent 任务。' : `${selectedModel?.name ?? '已启用配置'} · 密钥已保护` }}</span>
          </div>
        </div>
        <div class="model-field-grid">
          <label><span>配置名称</span><input v-model="modelForm.name" maxlength="100" /></label>
          <label><span>模型名称</span><input v-model="modelForm.model" maxlength="200" placeholder="例如 gpt-4.1-mini" /></label>
          <label>
            <span>服务商</span>
            <select v-model="modelForm.provider" @change="applyProviderPreset">
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">自定义兼容服务</option>
            </select>
          </label>
          <label>
            <span>接口协议</span>
            <select v-model="modelForm.protocol">
              <option value="auto">自动判断</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="openai-chat-completions">Chat Completions</option>
            </select>
          </label>
          <label class="wide"><span>Base URL</span><input v-model="modelForm.baseUrl" type="url" maxlength="2048" /></label>
          <div class="wide model-endpoint-preview">
            <span>实际请求地址</span>
            <code>{{ modelEndpointPreview }}</code>
          </div>
          <label><span>超时</span><input v-model.number="modelForm.timeoutMs" type="number" min="1000" max="120000" step="1000" /><small>毫秒</small></label>
          <label class="model-toggle"><input v-model="modelForm.enabled" type="checkbox" /><span>启用此配置</span></label>
          <fieldset class="wide model-capabilities">
            <legend>模型能力</legend>
            <label><input v-model="modelForm.capabilities.text" type="checkbox" disabled /><span>文本输入</span></label>
            <label><input v-model="modelForm.capabilities.vision" type="checkbox" /><span>图片理解</span></label>
            <label><input v-model="modelForm.capabilities.toolCalling" type="checkbox" /><span>工具调用</span></label>
            <label><input v-model="modelForm.capabilities.structuredOutput" type="checkbox" /><span>结构化输出</span></label>
            <small>“图片理解”用于 OJ 截图导入。请只在服务商和具体模型确实支持时开启。</small>
          </fieldset>
          <label class="wide model-key-field"><span>API Key</span><div><KeyRound :size="15" /><input v-model="modelForm.apiKey" type="password" maxlength="10000" autocomplete="new-password" :placeholder="selectedModel?.apiKeyConfigured ? '已安全保存；留空保持不变' : '输入新密钥'" /></div></label>
        </div>
        <footer class="model-actions">
          <span :class="{ success: modelNotice.startsWith('连接成功') || modelNotice.includes('已保存') }">{{ modelNotice }}</span>
          <button v-if="modelForm.id" class="icon-command danger" title="删除模型配置" :disabled="Boolean(modelAction)" @click="removeModel"><Trash2 :size="15" /></button>
          <button class="secondary-command" :disabled="!modelForm.id || !selectedModel?.apiKeyConfigured || Boolean(modelAction)" @click="clearModelKey"><KeyRound :size="14" />清除密钥</button>
          <button class="secondary-command" :disabled="!modelForm.id || !selectedModel?.apiKeyConfigured || Boolean(modelAction)" @click="testModel"><Wifi :size="14" />{{ modelAction === 'test' ? '测试中' : '测试连接' }}</button>
          <button class="secondary-command" :disabled="!modelForm.id || !selectedModel?.apiKeyConfigured || Boolean(modelAction)" @click="testModelVision"><ImagePlus :size="14" />{{ modelAction === 'vision' ? '识别中' : '测试图片输入' }}</button>
          <button class="primary-command" :disabled="!modelForm.name.trim() || !modelForm.model.trim() || !modelForm.baseUrl.trim() || Boolean(modelAction)" @click="saveModel"><Save :size="14" />{{ modelAction === 'save' ? '保存中' : '保存配置' }}</button>
        </footer>
      </section>

      <section v-show="activeSection === 'data'" id="data" class="settings-section">
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
  </div>
</template>
