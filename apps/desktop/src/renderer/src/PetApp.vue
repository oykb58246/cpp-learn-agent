<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PetDragWindowRequest, PetEvent, PetWindowState } from '@cpp-pet/contracts'
import DesktopPet from './components/DesktopPet.vue'

const state = ref<PetWindowState>({
  settings: { visible: true, assetMode: 'cpppilot-logo', scale: 1, ignoreMouseEvents: false, bubbleEnabled: true, focusModeEnabled: false, launchAtLogin: false, customAssets: [] },
  windowVisible: true,
  ignoreMouseEvents: false,
  growthStage: 1,
  progress: { stage: 1, totalStages: 4, percent: 25, label: '第 1 关 / 共 4 关 · 入门' }
})
const event = ref<PetEvent | null>({ eventId: crypto.randomUUID(), state: 'idle', message: 'CppPilot 待命' })
const chatOpen = ref(false)
const chatBusy = ref(false)
const chatNotice = ref('')
let stopState: (() => void) | undefined
let stopEvent: (() => void) | undefined
let stopQuickChat: (() => void) | undefined

onMounted(async () => {
  const result = await window.cppPet.pet.getState()
  if (result.ok) state.value = result.data
  stopState = window.cppPet.pet.onStateChanged(next => { state.value = next })
  stopEvent = window.cppPet.pet.onChanged(next => { event.value = next })
  stopQuickChat = window.cppPet.pet.onQuickChat(() => quickChat())
})

onBeforeUnmount(() => {
  stopState?.()
  stopEvent?.()
  stopQuickChat?.()
})

async function drag(request: PetDragWindowRequest) {
  const result = await window.cppPet.pet.drag(request)
  if (result.ok) state.value = result.data
}

function openMain() {
  void window.cppPet.pet.openMain()
}

function openContextMenu() {
  void window.cppPet.pet.showContextMenu()
}

function quickChat() {
  chatOpen.value = true
  chatNotice.value = ''
}

function closeChat() {
  if (chatBusy.value) return
  chatOpen.value = false
  chatNotice.value = ''
}

async function submitChat(message: string) {
  chatBusy.value = true
  chatNotice.value = '正在发送到 Agent'
  const result = await window.cppPet.pet.chat({ message })
  chatBusy.value = false
  if (result.ok) {
    chatNotice.value = '已发送，回答可在主窗口查看'
    event.value = { eventId: crypto.randomUUID(), state: 'thinking', message: '正在回答' }
  } else {
    chatNotice.value = result.error.message
    event.value = { eventId: crypto.randomUUID(), state: 'warning', message: result.error.message }
  }
}
</script>

<template>
  <main class="pet-app" aria-label="CppPilot 桌宠">
    <DesktopPet
      :state="state"
      :event="event"
      :chat-open="chatOpen"
      :chat-busy="chatBusy"
      :chat-notice="chatNotice"
      @drag="drag"
      @open-main="openMain"
      @quick-chat="quickChat"
      @close-chat="closeChat"
      @chat-submit="submitChat"
      @context-menu="openContextMenu"
    />
  </main>
</template>