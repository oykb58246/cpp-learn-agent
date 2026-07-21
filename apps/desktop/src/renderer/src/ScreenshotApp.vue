<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { ScreenshotPendingCapture } from '@cpp-pet/contracts'

const capture = ref<ScreenshotPendingCapture | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)
const message = ref('解释这张截图')
const error = ref('')
const busy = ref(false)
const selection = reactive({ active: false, startX: 0, startY: 0, x: 0, y: 0, width: 0, height: 0 })

const hasSelection = computed(() => selection.width > 8 && selection.height > 8)
const selectionStyle = computed(() => ({
  left: `${selection.x}px`,
  top: `${selection.y}px`,
  width: `${selection.width}px`,
  height: `${selection.height}px`,
  display: hasSelection.value || selection.active ? 'block' : 'none'
}))

onMounted(async () => {
  const result = await window.cppPet.screenshot.getPending()
  if (result.ok) capture.value = result.data
  else error.value = result.error.message
  if (!capture.value) error.value ||= '没有待确认的截图。'
})

function pointInStage(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return {
    x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    rect
  }
}

function beginSelect(event: PointerEvent) {
  const point = pointInStage(event)
  selection.active = true
  selection.startX = point.x
  selection.startY = point.y
  selection.x = point.x
  selection.y = point.y
  selection.width = 0
  selection.height = 0
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function moveSelect(event: PointerEvent) {
  if (!selection.active) return
  const point = pointInStage(event)
  selection.x = Math.min(selection.startX, point.x)
  selection.y = Math.min(selection.startY, point.y)
  selection.width = Math.abs(point.x - selection.startX)
  selection.height = Math.abs(point.y - selection.startY)
}

function endSelect(event: PointerEvent) {
  if (selection.active) {
    selection.active = false
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  }
}

async function submit() {
  const image = imageEl.value
  if (!image || !capture.value || !message.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const cropped = cropSelection(image)
    const result = await window.cppPet.screenshot.submit({
      message: message.value.trim(),
      previewDataUrl: cropped.previewDataUrl,
      width: cropped.width,
      height: cropped.height
    })
    if (!result.ok) error.value = result.error.message
  } finally {
    busy.value = false
  }
}

async function cancel() {
  await window.cppPet.screenshot.cancel()
}

function cropSelection(image: HTMLImageElement) {
  const displayed = image.getBoundingClientRect()
  const scaleX = image.naturalWidth / displayed.width
  const scaleY = image.naturalHeight / displayed.height
  const sourceX = hasSelection.value ? Math.round(selection.x * scaleX) : 0
  const sourceY = hasSelection.value ? Math.round(selection.y * scaleY) : 0
  const sourceWidth = hasSelection.value ? Math.round(selection.width * scaleX) : image.naturalWidth
  const sourceHeight = hasSelection.value ? Math.round(selection.height * scaleY) : image.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, sourceWidth)
  canvas.height = Math.max(1, sourceHeight)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建截图预览画布。')
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  return { previewDataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}
</script>

<template>
  <main class="screenshot-app">
    <section class="screenshot-stage" @pointerdown="beginSelect" @pointermove="moveSelect" @pointerup="endSelect" @pointercancel="endSelect">
      <img v-if="capture" ref="imageEl" :src="capture.previewDataUrl" alt="待确认截图" draggable="false" />
      <div class="screenshot-selection" :style="selectionStyle" />
    </section>
    <aside class="screenshot-confirm">
      <header>
        <strong>截图提问</strong>
        <span>{{ hasSelection ? `${Math.round(selection.width)} × ${Math.round(selection.height)}` : '未框选时发送整张截图' }}</span>
      </header>
      <textarea v-model="message" maxlength="20000" />
      <p v-if="error">{{ error }}</p>
      <footer>
        <button class="secondary-command" type="button" :disabled="busy" @click="cancel">取消</button>
        <button class="primary-command" type="button" :disabled="busy || !message.trim() || !capture" @click="submit">发送</button>
      </footer>
    </aside>
  </main>
</template>