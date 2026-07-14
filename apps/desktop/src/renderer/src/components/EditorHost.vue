<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Diagnostic } from '@cpp-pet/contracts'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'

const props = defineProps<{
  documentKey: string
  relativePath: string
  value: string
  readOnly?: boolean
  diagnostics?: Diagnostic[]
}>()
const emit = defineEmits<{ change: [value: string]; save: [] }>()
const host = ref<HTMLElement | null>(null)
const models = new Map<string, monaco.editor.ITextModel>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let changingModel = false
let themeObserver: MutationObserver | null = null

;(globalThis as unknown as { MonacoEnvironment: { getWorker(): Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

function language(path: string) {
  return /\.(?:cpp|cc|cxx|h|hpp)$/i.test(path) ? 'cpp' : path.endsWith('.json') ? 'json' : path.endsWith('.md') ? 'markdown' : 'plaintext'
}

function modelFor(key: string, path: string, value: string) {
  const existing = models.get(key)
  if (existing) return existing
  const model = monaco.editor.createModel(value, language(path), monaco.Uri.parse(`inmemory://cpp-pet/${encodeURIComponent(key)}`))
  models.set(key, model)
  return model
}

function applyTheme() {
  monaco.editor.setTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs')
}

function applyMarkers() {
  const model = editor?.getModel()
  if (!model) return
  const path = props.relativePath.replaceAll('\\', '/').toLowerCase()
  const markers = (props.diagnostics ?? [])
    .filter(item => item.file?.replaceAll('\\', '/').toLowerCase() === path && item.line)
    .map(item => ({
      severity: item.severity === 'error' ? monaco.MarkerSeverity.Error : item.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: item.normalizedMessage,
      startLineNumber: item.line ?? 1,
      startColumn: item.column ?? 1,
      endLineNumber: item.line ?? 1,
      endColumn: (item.column ?? 1) + 1,
      ...(item.code ? { code: item.code } : {})
    }))
  monaco.editor.setModelMarkers(model, 'cpp-pet', markers)
}

function switchModel() {
  if (!editor) return
  changingModel = true
  const model = modelFor(props.documentKey, props.relativePath, props.value)
  if (model.getValue() !== props.value) model.setValue(props.value)
  editor.setModel(model)
  editor.updateOptions({ readOnly: props.readOnly })
  changingModel = false
  applyMarkers()
  editor.focus()
}

function reveal(line: number, column = 1) {
  editor?.setPosition({ lineNumber: line, column })
  editor?.revealLineInCenter(line)
  editor?.focus()
}

defineExpose({ reveal })

onMounted(() => {
  applyTheme()
  editor = monaco.editor.create(host.value!, {
    model: null,
    automaticLayout: true,
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    padding: { top: 12, bottom: 12 },
    tabSize: 4,
    insertSpaces: true,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
    wordWrap: 'off',
    ariaLabel: 'C++ 代码编辑器'
  })
  editor.onDidChangeModelContent(() => {
    if (!changingModel) emit('change', editor?.getValue() ?? '')
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  switchModel()
})

watch(() => props.documentKey, switchModel)
watch(() => props.readOnly, value => editor?.updateOptions({ readOnly: value }))
watch(() => props.value, value => {
  const model = models.get(props.documentKey)
  if (!model || model.getValue() === value) return
  changingModel = true
  model.setValue(value)
  changingModel = false
})
watch(() => props.diagnostics, applyMarkers, { deep: true })

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  editor?.dispose()
  for (const model of models.values()) model.dispose()
})
</script>

<template><div ref="host" class="monaco-editor-host" /></template>
