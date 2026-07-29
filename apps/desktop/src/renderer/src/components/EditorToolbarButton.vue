<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  shortcut?: string
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'run' | 'debug' | 'stop'
  help?: boolean
}>(), {
  shortcut: '',
  disabled: false,
  active: false,
  tone: 'default',
  help: false
})

const emit = defineEmits<{
  click: []
  contextmenu: [event: MouseEvent]
}>()

const tooltip = computed(() => [
  props.label,
  props.shortcut,
  props.help ? '右键查看帮助' : ''
].filter(Boolean).join(' · '))
</script>

<template>
  <el-tooltip :content="tooltip" placement="bottom" :show-after="280">
    <span class="toolbar-tooltip-trigger" @contextmenu.prevent="emit('contextmenu', $event)">
      <button
        type="button"
        :class="['editor-tool-button', tone, { active }]"
        :disabled="disabled"
        :aria-label="label"
        @click="emit('click')"
      >
        <slot />
      </button>
    </span>
  </el-tooltip>
</template>
