<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'

const props = defineProps<{ relativePath: string; original: string; modified: string }>()
const emit = defineEmits<{ change: [value: string] }>()
const host = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneDiffEditor | null = null
let originalModel: monaco.editor.ITextModel | null = null
let modifiedModel: monaco.editor.ITextModel | null = null
let applying = false

function createModels() {
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = monaco.editor.createModel(props.original, 'cpp')
  modifiedModel = monaco.editor.createModel(props.modified, 'cpp')
  editor?.setModel({ original: originalModel, modified: modifiedModel })
  modifiedModel.onDidChangeContent(() => {
    if (!applying) emit('change', modifiedModel?.getValue() ?? '')
  })
}

onMounted(() => {
  editor = monaco.editor.createDiffEditor(host.value!, {
    automaticLayout: true,
    renderSideBySide: true,
    originalEditable: false,
    readOnly: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 13,
    lineHeight: 21,
    ariaLabel: `${props.relativePath} 冲突对比`
  })
  createModels()
})

watch(() => props.original, createModels)
watch(() => props.modified, value => {
  if (!modifiedModel || modifiedModel.getValue() === value) return
  applying = true
  modifiedModel.setValue(value)
  applying = false
})

onBeforeUnmount(() => {
  editor?.dispose()
  originalModel?.dispose()
  modifiedModel?.dispose()
})
</script>

<template><div ref="host" class="monaco-diff-host" /></template>
