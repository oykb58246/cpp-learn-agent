<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PetAssetMode, PetDragWindowRequest, PetEvent, PetWindowState } from '@cpp-pet/contracts'
import logoUrl from '../assets/logo.png'
import catUrl from '../assets/cat.GIF'
import { createPetDragRequest, createPetDragSession, type PetDragSession } from '../utils/pet-drag'

const WINDOW_DRAG_THRESHOLD_PX = 4

const props = withDefaults(defineProps<{
  state: PetWindowState
  event?: PetEvent | null
  chatOpen?: boolean
  chatBusy?: boolean
  chatNotice?: string
}>(), { chatOpen: false, chatBusy: false, chatNotice: '' })

const emit = defineEmits<{
  drag: [request: PetDragWindowRequest]
  dragEnd: []
  undock: []
  openMain: []
  quickChat: []
  closeChat: []
  chatSubmit: [message: string]
  contextMenu: []
}>()

interface DragState extends PetDragSession {
  pointerId: number
  dragging: boolean
}

const dragState = ref<DragState | null>(null)
const suppressClick = ref(false)
const CHAT_DRAFT_KEY = 'cpppilot.pet.quick-chat-draft'
const chatText = ref((() => {
  try { return localStorage.getItem(CHAT_DRAFT_KEY) ?? '' } catch { return '' }
})())

watch(chatText, value => {
  try { localStorage.setItem(CHAT_DRAFT_KEY, value) } catch { /* ignore quota */ }
})
const imageFailed = ref(false)
const hearts = ref<Array<{ id: number; left: number; delay: number; size: number }>>([])
let heartTimer: ReturnType<typeof setInterval> | undefined
let heartId = 0

const builtInAssets: Record<Exclude<PetAssetMode, 'custom'>, { url: string; name: string; className: string }> = {
  'cpppilot-logo': { url: logoUrl, name: 'CppPilot Logo 桌宠', className: 'logo' },
  'salary-cat': { url: catUrl, name: 'Salary Cat 桌宠', className: 'cat' }
}

const eventState = computed(() => props.event?.state ?? 'idle')
const visualState = computed(() => props.state.settings.focusModeEnabled ? 'idle' : eventState.value)
const growthStage = computed(() => props.state.growthStage ?? 1)
const progressPercent = computed(() => Math.max(0, Math.min(100, props.state.progress?.percent ?? Math.round(growthStage.value / 4 * 100))))
const progressLabel = computed(() => props.state.progress?.label ?? `${growthStage.value}/4 · ${progressPercent.value}%`)
const progressSummary = computed(() => {
  const fallback = `${growthStage.value}/4 · ${progressPercent.value}%`
  const [levelToken, stageToken, percentToken] = (props.state.progress?.label ?? fallback).split('·').map(item => item.trim())
  return {
    levelToken: levelToken || `Lv.${growthStage.value}`,
    stageToken: stageToken || `${growthStage.value}/4`,
    percentToken: percentToken || `${progressPercent.value}%`
  }
})
const progressStyle = computed(() => ({ width: `${progressPercent.value}%` }))
const activeCustomAsset = computed(() => {
  const assets = props.state.settings.customAssets ?? []
  return assets.find(item => item.id === props.state.settings.activeCustomAssetId) ?? assets[0]
})
const asset = computed(() => {
  if (props.state.settings.assetMode === 'custom' && props.state.customAssetUrl && activeCustomAsset.value && !imageFailed.value) {
    return { url: props.state.customAssetUrl, name: activeCustomAsset.value.name, className: 'custom' }
  }
  const mode = props.state.settings.assetMode as Exclude<PetAssetMode, 'custom'>
  return builtInAssets[mode] ?? builtInAssets['cpppilot-logo']
})
const fallbackMessage = computed(() => {
  switch (eventState.value) {
    case 'listen': return '收到学习请求'
    case 'thinking': return '正在规划'
    case 'tool-running': return '正在调用工具'
    case 'approval': return '等待确认'
    case 'success': return '任务完成'
    case 'warning': return '需要处理'
    case 'level-up': return '等级提升啦！'
    default: return '我在这儿陪你写 C++～'
  }
})
const bubble = computed(() => props.state.settings.bubbleEnabled && !props.state.settings.focusModeEnabled ? (props.event?.message ?? fallbackMessage.value) : '')
const dragging = computed(() => Boolean(dragState.value?.dragging))
const isAnimatedAsset = computed(() => asset.value.className === 'cat')

watch(() => [props.state.settings.assetMode, props.state.settings.activeCustomAssetId, props.state.customAssetUrl], () => { imageFailed.value = false })

function spawnHearts() {
  if (props.state.settings.focusModeEnabled || dragging.value || props.state.settings.docked) return
  const burst = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => {
    heartId += 1
    return {
      id: heartId,
      // 偏上：靠近头部区域冒出
      left: 30 + Math.random() * 40,
      delay: Math.random() * 0.25,
      size: 10 + Math.random() * 8
    }
  })
  hearts.value = burst
  window.setTimeout(() => {
    if (hearts.value[0]?.id === burst[0]?.id) hearts.value = []
  }, 2200)
}

onMounted(() => {
  heartTimer = setInterval(() => {
    if (Math.random() > 0.45) spawnHearts()
  }, 12_000 + Math.random() * 8_000)
  window.setTimeout(() => spawnHearts(), 1800)
})
onBeforeUnmount(() => {
  if (heartTimer) clearInterval(heartTimer)
})

function startDrag(event: PointerEvent) {
  dragState.value = {
    ...createPetDragSession({
      windowX: window.screenX,
      windowY: window.screenY,
      windowWidth: window.outerWidth,
      windowHeight: window.outerHeight,
      pointerScreenX: event.screenX,
      pointerScreenY: event.screenY
    }),
    pointerId: event.pointerId,
    dragging: false
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  const state = dragState.value
  if (!state || state.pointerId !== event.pointerId) return
  const totalX = event.screenX - state.pointerStartScreenX
  const totalY = event.screenY - state.pointerStartScreenY
  if (!state.dragging && Math.hypot(totalX, totalY) < WINDOW_DRAG_THRESHOLD_PX) return
  state.dragging = true
  suppressClick.value = true
  event.preventDefault()
  emit('drag', createPetDragRequest(state, { screenX: event.screenX, screenY: event.screenY }))
}

function endDrag(event: PointerEvent) {
  if (dragState.value?.pointerId === event.pointerId) {
    const wasDragging = dragState.value.dragging
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
    dragState.value = null
    if (wasDragging) emit('dragEnd')
  }
}

function handleClick(event: MouseEvent) {
  if (suppressClick.value) {
    suppressClick.value = false
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (props.state.settings.docked) {
    emit('undock')
    return
  }
  // 再次单击桌宠关闭速问面板；输入草稿保留
  if (props.chatOpen) {
    if (!props.chatBusy) emit('closeChat')
    return
  }
  emit('quickChat')
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault()
  emit('contextMenu')
}

function submitChat() {
  const message = chatText.value.trim()
  if (!message || props.chatBusy) return
  emit('chatSubmit', message)
  chatText.value = ''
  try { localStorage.removeItem(CHAT_DRAFT_KEY) } catch { /* ignore */ }
}
</script>

<template>
  <section
    :class="['desktop-pet', `state-${visualState}`, `pass-stage-${growthStage}`, {
      passthrough: state.ignoreMouseEvents,
      dragging,
      'focus-mode': state.settings.focusModeEnabled,
      'asset-animated': isAnimatedAsset,
      docked: state.settings.docked,
      'hide-frame': state.settings.frameEnabled === false,
      'hide-progress': state.settings.progressBarEnabled === false
    }]"
    @contextmenu="handleContextMenu"
  >
    <div :class="['desktop-pet-body', { 'chat-open': chatOpen }]">
      <!-- 速问面板固定在窗口顶部，与宠物分层，避免被形象盖住 -->
      <form v-if="chatOpen" class="pet-chat-card" @submit.prevent="submitChat" @pointerdown.stop @click.stop>
        <header class="pet-chat-card-header">
          <div>
            <strong>问 CppPilot</strong>
            <span>{{ chatBusy ? '正在思考…' : '轻量速问，详细回答会同步到主窗口' }}</span>
          </div>
          <button type="button" class="pet-chat-close" title="关闭" @click="emit('closeChat')">×</button>
        </header>
        <div class="pet-chat-card-body">
          <textarea
            v-model="chatText"
            rows="3"
            maxlength="20000"
            :disabled="chatBusy"
            placeholder="例如：这段循环为什么会越界？"
            @keydown.ctrl.enter="submitChat"
          />
          <div class="pet-chat-card-actions">
            <button type="submit" class="pet-chat-primary" :disabled="chatBusy || !chatText.trim()">发送</button>
            <button type="button" class="pet-chat-secondary" @click="emit('openMain')">打开工作区对话</button>
          </div>
          <small v-if="chatNotice" :class="{ busy: chatBusy }">{{ chatNotice }}</small>
        </div>
      </form>

      <div class="desktop-pet-stage">
        <div v-if="bubble && !chatOpen" class="desktop-pet-bubble" role="status">
          <p>{{ bubble }}</p>
          <i class="desktop-pet-bubble-tail" aria-hidden="true" />
        </div>
        <button
          class="desktop-pet-button"
          type="button"
          :aria-label="asset.name"
          @click="handleClick"
          @pointerdown="startDrag"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <span class="pet-aura" aria-hidden="true" />
          <span v-if="state.settings.frameEnabled !== false" :class="['pet-status-frame', `frame-${visualState}`]" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <span class="pet-avatar-wrap" aria-hidden="true">
            <img :class="['desktop-pet-image', asset.className]" :src="asset.url" :alt="asset.name" draggable="false" @error="imageFailed = true" />
            <span v-if="!isAnimatedAsset" class="pet-paw" />
            <span class="pet-hearts" aria-hidden="true">
              <i
                v-for="item in hearts"
                :key="item.id"
                class="pet-heart"
                :style="{ left: `${item.left}%`, animationDelay: `${item.delay}s`, fontSize: `${item.size}px` }"
              >♥</i>
            </span>
          </span>
        </button>
      </div>
      <div v-if="state.settings.progressBarEnabled !== false && !state.settings.docked" class="desktop-pet-progress" role="progressbar" :aria-label="progressLabel" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progressPercent">
        <div class="desktop-pet-progress-meta"><span>{{ progressSummary.levelToken }}</span><b>{{ progressSummary.stageToken }}</b><em>{{ progressSummary.percentToken }}</em></div>
        <div class="desktop-pet-progress-track"><i :style="progressStyle" /></div>
      </div>
    </div>
  </section>
</template>

