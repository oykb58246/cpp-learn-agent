<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PetDragWindowRequest, PetEvent, PetWindowState } from '@cpp-pet/contracts'
import DesktopPet from './components/DesktopPet.vue'

const state = ref<PetWindowState>({
  settings: {
    visible: true,
    assetMode: 'cpppilot-logo',
    scale: 1,
    ignoreMouseEvents: false,
    bubbleEnabled: true,
    frameEnabled: true,
    progressBarEnabled: true,
    edgeDockEnabled: true,
    docked: false,
    focusModeEnabled: false,
    launchAtLogin: false,
    customAssets: []
  },
  windowVisible: true,
  ignoreMouseEvents: false,
  growthStage: 1,
  progress: { stage: 1, totalStages: 4, percent: 25, label: '第 1 关 / 共 4 关 · 入门' },
  theme: 'system'
})
const event = ref<PetEvent | null>({ eventId: crypto.randomUUID(), state: 'idle', message: '我在这儿陪你写 C++～' })
const chatOpen = ref(false)
const chatBusy = ref(false)
const chatNotice = ref('')
let stopState: (() => void) | undefined
let stopEvent: (() => void) | undefined
let stopQuickChat: (() => void) | undefined

function applyPetTheme(theme: 'system' | 'light' | 'dark' | undefined) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

function applyPetState(next: PetWindowState) {
  state.value = next
  if (next.theme) applyPetTheme(next.theme)
}

onMounted(async () => {
  const [petState, settings] = await Promise.all([
    window.cppPet.pet.getState(),
    window.cppPet.settings.get()
  ])
  if (settings.ok) applyPetTheme(settings.data.theme)
  if (petState.ok) applyPetState(petState.data)
  stopState = window.cppPet.pet.onStateChanged(next => { applyPetState(next) })
  stopEvent = window.cppPet.pet.onChanged(next => { event.value = next })
  stopQuickChat = window.cppPet.pet.onQuickChat(() => {
    if (state.value.settings.docked) {
      void window.cppPet.pet.undock().then(result => {
        if (result.ok) applyPetState(result.data)
        showQuickChat()
      })
      return
    }
    showQuickChat()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyPetTheme(state.value.theme ?? 'system')
  })
})

onBeforeUnmount(() => {
  stopState?.()
  stopEvent?.()
  stopQuickChat?.()
})

async function drag(request: PetDragWindowRequest) {
  const result = await window.cppPet.pet.drag(request)
  if (result.ok) applyPetState(result.data)
}

async function dragEnd() {
  const result = await window.cppPet.pet.dragEnd()
  if (result.ok) applyPetState(result.data)
}

async function undock() {
  const result = await window.cppPet.pet.undock()
  if (result.ok) applyPetState(result.data)
}

function openMain() {
  void window.cppPet.pet.openMain()
}

function openContextMenu() {
  void window.cppPet.pet.showContextMenu()
}

async function activatePet() {
  const result = await window.cppPet.pet.activate()
  if (!result.ok) {
    chatNotice.value = result.error.message
    event.value = { eventId: crypto.randomUUID(), state: 'warning', message: result.error.message }
  }
}

function showQuickChat() {
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
      @drag-end="dragEnd"
      @undock="undock"
      @open-main="openMain"
      @quick-chat="activatePet"
      @close-chat="closeChat"
      @chat-submit="submitChat"
      @context-menu="openContextMenu"
    />
  </main>
</template>
