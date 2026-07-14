<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Diagnostic } from '@cpp-pet/contracts'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'

const props = defineProps<{
  documentKey: string
  projectId: string
  relativePath: string
  value: string
  readOnly?: boolean
  diagnostics?: Diagnostic[]
  languageEnabled?: boolean
  breakpoints?: number[]
  debugLine?: number | undefined
}>()
const emit = defineEmits<{
  change: [value: string]
  save: []
  definition: [location: { relativePath: string; line: number; column: number }]
  toggleBreakpoint: [line: number]
  languageFailed: [reason: string]
}>()
const host = ref<HTMLElement | null>(null)
const models = new Map<string, monaco.editor.ITextModel>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let changingModel = false
let themeObserver: MutationObserver | null = null
let languageSyncTimer: ReturnType<typeof setTimeout> | undefined
let languageFailureReported = false
let editorDecorations: monaco.editor.IEditorDecorationsCollection | null = null
const languageProviders: monaco.IDisposable[] = []

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

function applyDecorations() {
  if (!editor) return
  const breakpoints = props.breakpoints ?? []
  const decorations: monaco.editor.IModelDeltaDecoration[] = breakpoints.map(line => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: 'cpp-pet-breakpoint',
      glyphMarginHoverMessage: { value: `断点：第 ${line} 行` }
    }
  }))
  if (props.debugLine) {
    decorations.push({
      range: new monaco.Range(props.debugLine, 1, props.debugLine, 1),
      options: {
        isWholeLine: true,
        className: 'cpp-pet-debug-line',
        glyphMarginClassName: 'cpp-pet-debug-pointer',
        glyphMarginHoverMessage: { value: '调试器暂停在此处' }
      }
    })
  }
  editorDecorations?.set(decorations)
}

function reportLanguageFailure(message: string) {
  if (languageFailureReported) return
  languageFailureReported = true
  emit('languageFailed', message)
}

async function syncLanguage() {
  if (!props.languageEnabled || language(props.relativePath) !== 'cpp') return
  const model = editor?.getModel()
  if (!model) return
  const result = await window.cppPet.language.sync({
    projectId: props.projectId,
    relativePath: props.relativePath,
    content: model.getValue(),
    version: Math.max(1, model.getVersionId())
  })
  if (!result.ok) reportLanguageFailure(result.error.message)
}

function scheduleLanguageSync(immediate = false) {
  clearTimeout(languageSyncTimer)
  if (!props.languageEnabled) return
  if (immediate) void syncLanguage()
  else languageSyncTimer = setTimeout(() => void syncLanguage(), 250)
}

function languagePosition(position: monaco.Position) {
  return {
    projectId: props.projectId,
    relativePath: props.relativePath,
    line: position.lineNumber,
    column: position.column
  }
}

function registerLanguageProviders() {
  languageProviders.push(monaco.languages.registerCompletionItemProvider('cpp', {
    triggerCharacters: ['.', ':', '>', '<'],
    async provideCompletionItems(model, position) {
      if (!props.languageEnabled || model !== editor?.getModel()) return { suggestions: [] }
      await syncLanguage()
      const result = await window.cppPet.language.completion(languagePosition(position))
      if (!result.ok) {
        reportLanguageFailure(result.error.message)
        return { suggestions: [] }
      }
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
      return {
        suggestions: result.data.map(item => ({
          label: item.label,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: item.insertText ?? item.label,
          range,
          ...(item.detail ? { detail: item.detail } : {}),
          ...(item.documentation ? { documentation: { value: item.documentation } } : {})
        }))
      }
    }
  }))
  languageProviders.push(monaco.languages.registerHoverProvider('cpp', {
    async provideHover(model, position) {
      if (!props.languageEnabled || model !== editor?.getModel()) return null
      const result = await window.cppPet.language.hover(languagePosition(position))
      if (!result.ok) {
        reportLanguageFailure(result.error.message)
        return null
      }
      return result.data ? { contents: [{ value: result.data.contents }] } : null
    }
  }))
  languageProviders.push(monaco.languages.registerDefinitionProvider('cpp', {
    async provideDefinition(model, position) {
      if (!props.languageEnabled || model !== editor?.getModel()) return null
      const result = await window.cppPet.language.definition(languagePosition(position))
      if (!result.ok) {
        reportLanguageFailure(result.error.message)
        return null
      }
      if (!result.data) return null
      emit('definition', result.data)
      if (result.data.relativePath.replaceAll('\\', '/').toLowerCase() !== props.relativePath.replaceAll('\\', '/').toLowerCase()) return null
      return {
        uri: model.uri,
        range: new monaco.Range(result.data.line, result.data.column, result.data.line, result.data.column)
      }
    }
  }))
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
  applyDecorations()
  languageFailureReported = false
  scheduleLanguageSync(true)
  editor.focus()
}

function reveal(line: number, column = 1) {
  editor?.setPosition({ lineNumber: line, column })
  editor?.revealLineInCenter(line)
  editor?.focus()
}

function position() {
  const value = editor?.getPosition()
  return value ? { line: value.lineNumber, column: value.column } : { line: 1, column: 1 }
}

defineExpose({ reveal, position })

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
    glyphMargin: true,
    ariaLabel: 'C++ 代码编辑器'
  })
  editorDecorations = editor.createDecorationsCollection()
  editor.onDidChangeModelContent(() => {
    if (!changingModel) {
      emit('change', editor?.getValue() ?? '')
      scheduleLanguageSync()
    }
  })
  editor.onMouseDown(event => {
    if (props.readOnly || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
    const line = event.target.position?.lineNumber
    if (line) emit('toggleBreakpoint', line)
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  registerLanguageProviders()
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
watch(() => props.breakpoints, applyDecorations, { deep: true })
watch(() => props.debugLine, applyDecorations)
watch(() => props.languageEnabled, enabled => {
  languageFailureReported = false
  if (enabled) scheduleLanguageSync(true)
  else clearTimeout(languageSyncTimer)
})

onBeforeUnmount(() => {
  clearTimeout(languageSyncTimer)
  themeObserver?.disconnect()
  for (const provider of languageProviders) provider.dispose()
  editorDecorations?.clear()
  editor?.dispose()
  for (const model of models.values()) model.dispose()
})
</script>

<template><div ref="host" class="monaco-editor-host" /></template>
