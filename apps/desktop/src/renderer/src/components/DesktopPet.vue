<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
const chatText = ref('')
const imageFailed = ref(false)

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
    case 'level-up': return '等级提升'
    default: return 'CppPilot 待命'
  }
})
const bubble = computed(() => props.state.settings.bubbleEnabled && !props.state.settings.focusModeEnabled ? (props.event?.message ?? fallbackMessage.value) : '')
const dragging = computed(() => Boolean(dragState.value?.dragging))

watch(() => [props.state.settings.assetMode, props.state.settings.activeCustomAssetId, props.state.customAssetUrl], () => { imageFailed.value = false })

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
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
    dragState.value = null
  }
}

function handleClick(event: MouseEvent) {
  if (suppressClick.value) {
    suppressClick.value = false
    event.preventDefault()
    event.stopPropagation()
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
}
</script>

<template>
  <section
    :class="['desktop-pet', `state-${visualState}`, `pass-stage-${growthStage}`, { passthrough: state.ignoreMouseEvents, dragging, 'focus-mode': state.settings.focusModeEnabled }]"
    @contextmenu="handleContextMenu"
  >
    <p v-if="bubble" class="desktop-pet-bubble">{{ bubble }}</p>
    <div class="desktop-pet-body">
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
        <span :class="['pet-status-frame', `frame-${visualState}`]" aria-hidden="true"><i /><i /><i /></span>
        <img :class="['desktop-pet-image', asset.className]" :src="asset.url" :alt="asset.name" draggable="false" @error="imageFailed = true" />
      </button>
      <div class="desktop-pet-progress" role="progressbar" :aria-label="progressLabel" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progressPercent">
        <div class="desktop-pet-progress-meta"><span>{{ progressSummary.levelToken }}</span><b>{{ progressSummary.stageToken }}</b><em>{{ progressSummary.percentToken }}</em></div>
        <div class="desktop-pet-progress-track"><i :style="progressStyle" /></div>
      </div>
    </div>
    <form v-if="chatOpen" class="pet-chat-popover" @submit.prevent="submitChat" @pointerdown.stop @click.stop>
      <input v-model="chatText" maxlength="20000" :disabled="chatBusy" placeholder="问 CppPilot" />
      <div class="pet-chat-actions">
        <button type="submit" :disabled="chatBusy || !chatText.trim()">发送</button>
        <button type="button" @click="emit('openMain')">主窗口</button>
        <button type="button" @click="emit('closeChat')">关闭</button>
      </div>
      <small v-if="chatNotice">{{ chatNotice }}</small>
    </form>
  </section>
</template>

