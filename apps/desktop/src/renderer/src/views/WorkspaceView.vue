<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Boxes,
  Bug,
  Camera,
  CheckCheck,
  CornerDownRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  Hammer,
  History,
  MoreHorizontal,
  Move,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  ScanSearch,
  Square,
  StepForward,
  Terminal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-vue-next'
import { ElMessageBox } from 'element-plus'
import type {
  BuildResult,
  CmakeBuildResult,
  CtestRunResult,
  DebugCommand,
  DebugSessionState,
  Diagnostic,
  DiagnosticExplanationSnapshot,
  DiagnosticOccurrence,
  AgentStartRequest,
  FileTreeNode,
  ProgramRunResult,
  StaticAnalysisResult
} from '@cpp-pet/contracts'
import DiffEditorHost from '../components/DiffEditorHost.vue'
import EditorHost from '../components/EditorHost.vue'
import FileTree from '../components/FileTree.vue'
import ProjectDialog from '../components/ProjectDialog.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import ConversationPanel from '../components/ConversationPanel.vue'
import DiagnosticInboxPopover from '../components/DiagnosticInboxPopover.vue'
import RunTimeline from '../components/RunTimeline.vue'
import { useAppStore } from '../stores/app'
import { useAgentStore } from '../stores/agent'
import { useWorkspaceStore } from '../stores/workspace'
import type { AgentEditorSelection } from '../utils/editor-selection'
import { diagnosticBadgeLabel } from '../utils/diagnostic-inbox'

const app = useAppStore()
const store = useWorkspaceStore()
const agent = useAgentStore()
const route = useRoute()
const router = useRouter()
const workspaceView = ref<HTMLElement | null>(null)
const dialog = ref(false)
const search = ref('')
const snapshotLabel = ref('')
const inspectorOpen = ref(true)
const contextNode = ref<FileTreeNode | null>(null)
const contextPos = ref({ x: 0, y: 0 })
const active = computed(() => store.activeTab)
const editorHost = ref<InstanceType<typeof EditorHost> | null>(null)
const editorFontSize = ref(13)
const agentOpen = ref(false)
const inboxOpen = ref(false)
const agentSelection = ref<AgentEditorSelection>()
const diffOpen = ref(false)
const panelOpen = ref(true)
const panelTab = ref<'output' | 'problems' | 'debug'>('output')
const sidebarWidth = ref(260)
const inspectorWidth = ref(320)
const bottomPanelHeight = ref(190)
const standard = ref<'c++17' | 'c++20' | 'c++23'>('c++17')
const standardInput = ref('')
const executing = ref<'build' | 'run' | 'cmake' | 'ctest' | 'analysis' | null>(null)
const currentRunId = ref('')
const buildResult = ref<BuildResult | null>(null)
const runResult = ref<ProgramRunResult | null>(null)
const cmakeResult = ref<CmakeBuildResult | null>(null)
const ctestResult = ref<CtestRunResult | null>(null)
const analysisResult = ref<StaticAnalysisResult | null>(null)
const diagnostics = ref<Diagnostic[]>([])
const languageDiagnostics = ref<Record<string, Diagnostic[]>>({})
const languageAvailable = ref(false)
const languageStatusText = ref('正在检测 clangd…')
const breakpoints = ref<Record<string, number[]>>({})
const debugState = ref<DebugSessionState | null>(null)
const debuggerBusy = ref(false)
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
let stopLanguageDiagnostics: (() => void) | undefined
type ResizeTarget = 'sidebar' | 'inspector' | 'panel'
const minimumEditorWidth = 420
let resizeSession: { target: ResizeTarget; startX: number; startY: number; startValue: number } | undefined

const layoutStyle = computed(() => ({
  '--workspace-sidebar-width': `${sidebarWidth.value}px`,
  '--workspace-inspector-width': `${inspectorWidth.value}px`,
  '--workspace-bottom-panel-height': `${bottomPanelHeight.value}px`
}))

const entryDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'rename' | 'copy' | 'move',
  kind: 'file' as 'file' | 'directory',
  source: '',
  value: ''
})
const canBuild = computed(() => Boolean(active.value && /\.(?:cpp|cc|cxx)$/i.test(active.value.relativePath) && !executing.value))
const canAnalyze = computed(() => Boolean(active.value && /\.(?:cpp|cc|cxx|h|hpp)$/i.test(active.value.relativePath) && !executing.value))
const canCmake = computed(() => Boolean(store.currentProject?.type === 'cmake' && !executing.value))
const canTest = computed(() => Boolean(cmakeResult.value?.success && !executing.value))
const canDebug = computed(() => Boolean(active.value && /\.(?:cpp|cc|cxx)$/i.test(active.value.relativePath) && !executing.value && !debuggerBusy.value && !active.value.conflicted))
const canControlDebug = computed(() => debugState.value?.status === 'stopped' && !debuggerBusy.value)
const currentBreakpoints = computed(() => active.value ? breakpoints.value[active.value.relativePath] ?? [] : [])
const currentDebugLine = computed(() => {
  const location = debugState.value?.location
  if (!location || normalizePath(location.relativePath) !== normalizePath(active.value?.relativePath ?? '')) return undefined
  return location.line
})
const allDiagnostics = computed(() => [
  ...diagnostics.value,
  ...Object.values(languageDiagnostics.value).flat()
])
const activeDiagnostics = computed(() => {
  const path = active.value?.relativePath
  if (!path) return []
  const normalized = normalizePath(path)
  return allDiagnostics.value.filter(item => !item.file || normalizePath(item.file) === normalized)
})
const agentTimeline = computed(() => agent.currentRun && 'timeline' in agent.currentRun ? agent.currentRun.timeline.slice(-6) : [])
const agentRunning = computed(() => Boolean(agent.currentRun && !['completed', 'failed', 'cancelled'].includes(agent.currentRun.status)))
const inboxGroups = computed(() => agent.inbox?.groups ?? [])
const inboxCount = computed(() => inboxGroups.value.length)
const outputText = computed(() => {
  const chunks: string[] = []
  if (buildResult.value) {
    const item = buildResult.value
    chunks.push(`[编译] ${item.success ? '成功' : item.process.cancelled ? '已停止' : '失败'} · ${item.process.durationMs} ms · ${item.artifactName}`)
    if (item.process.stdout.trim()) chunks.push(item.process.stdout.trimEnd())
    if (item.process.stderr.trim()) chunks.push(item.process.stderr.trimEnd())
    if (item.process.outputTruncated) chunks.push('[输出已达到 512 KiB 上限，后续内容被截断]')
  }
  if (runResult.value) {
    const item = runResult.value
    chunks.push(`[运行] ${item.success ? '成功' : item.process.cancelled ? '已停止' : item.process.timedOut ? '超时' : '异常退出'} · ${item.process.durationMs} ms · 退出码 ${item.process.exitCode ?? '无'}`)
    if (item.process.stdout) chunks.push(item.process.stdout.trimEnd())
    if (item.process.stderr.trim()) chunks.push(item.process.stderr.trimEnd())
    if (item.process.outputTruncated) chunks.push('[输出已达到 512 KiB 上限，后续内容被截断]')
  }
  if (cmakeResult.value) {
    const item = cmakeResult.value
    chunks.push(`[CMake 配置] ${item.configure.exitCode === 0 ? '成功' : item.configure.cancelled ? '已停止' : '失败'} · ${item.configure.durationMs} ms`)
    if (item.configure.stdout.trim()) chunks.push(item.configure.stdout.trimEnd())
    if (item.configure.stderr.trim()) chunks.push(item.configure.stderr.trimEnd())
    if (item.build) {
      chunks.push(`[CMake 构建] ${item.success ? '成功' : item.build.cancelled ? '已停止' : '失败'} · ${item.build.durationMs} ms · compile_commands.json ${item.compileCommandsGenerated ? '已生成' : '未生成'}`)
      if (item.build.stdout.trim()) chunks.push(item.build.stdout.trimEnd())
      if (item.build.stderr.trim()) chunks.push(item.build.stderr.trimEnd())
    }
  }
  if (ctestResult.value) {
    const item = ctestResult.value
    chunks.push(`[CTest] ${item.success ? '通过' : item.process.cancelled ? '已停止' : item.process.timedOut ? '超时' : '失败'} · ${item.passed}/${item.total} 通过 · ${item.process.durationMs} ms`)
    if (item.process.stdout.trim()) chunks.push(item.process.stdout.trimEnd())
    if (item.process.stderr.trim()) chunks.push(item.process.stderr.trimEnd())
  }
  if (analysisResult.value) {
    const item = analysisResult.value
    chunks.push(`[clang-tidy] ${item.success ? '完成' : item.process.cancelled ? '已停止' : '发现问题'} · ${item.diagnostics.length} 条诊断 · ${item.process.durationMs} ms`)
    if (item.process.stdout.trim()) chunks.push(item.process.stdout.trimEnd())
    if (item.process.stderr.trim()) chunks.push(item.process.stderr.trimEnd())
  }
  return chunks.join('\n\n') || '尚未执行编译、运行、测试或静态分析。'
})

onMounted(async () => {
  agent.subscribe()
  window.addEventListener('resize', fitLayoutToViewport)
  stopLanguageDiagnostics = window.cppPet.language.onDiagnostics(event => {
    if (event.projectId !== store.currentProject?.id) return
    languageDiagnostics.value = {
      ...languageDiagnostics.value,
      [normalizePath(event.relativePath)]: event.diagnostics
    }
  })
  await Promise.all([store.loadProjects(), agent.refreshAll()])
  const id = route.params.projectId as string | undefined
  if (id) await store.openProject(id)
  else if (store.projects[0]) {
    await store.openProject(store.projects[0].id)
    await router.replace(`/workspace/${store.projects[0].id}`)
  }
  fitLayoutToViewport()
})
onBeforeUnmount(() => {
  clearTimeout(autoSaveTimer)
  stopResize()
  window.removeEventListener('resize', fitLayoutToViewport)
  stopLanguageDiagnostics?.()
  agent.dispose()
  if (debugState.value && !['exited', 'error'].includes(debugState.value.status)) {
    void window.cppPet.debug.command({ sessionId: debugState.value.sessionId, command: 'stop' })
  }
})
watch(() => route.params.projectId, async id => {
  if (typeof id === 'string' && id !== store.currentProject?.id) await store.openProject(id)
})
watch(() => active.value?.relativePath, () => { diffOpen.value = false; agentSelection.value = undefined })
watch(
  () => [app.settings.sidebarWidth, app.settings.inspectorWidth, app.settings.bottomPanelHeight] as const,
  ([savedSidebarWidth, savedInspectorWidth, savedBottomPanelHeight]) => {
    if (resizeSession) return
    sidebarWidth.value = savedSidebarWidth
    inspectorWidth.value = savedInspectorWidth
    bottomPanelHeight.value = savedBottomPanelHeight
    void nextTick(fitLayoutToViewport)
  },
  { immediate: true }
)
watch(() => store.currentProject?.id, async id => {
  inboxOpen.value = false
  languageDiagnostics.value = {}
  languageAvailable.value = false
  languageStatusText.value = id ? '正在检测 clangd…' : ''
  if (!id) return
  await agent.loadProjectAgent(id)
  const result = await window.cppPet.language.status({ projectId: id })
  if (!result.ok) {
    languageStatusText.value = result.error.message
    return
  }
  languageAvailable.value = result.data.available
  languageStatusText.value = result.data.available ? 'clangd 已连接' : (result.data.reason ?? 'clangd 不可用')
})

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)))
}
function resizeLimit(target: ResizeTarget) {
  const width = workspaceView.value?.clientWidth ?? window.innerWidth
  const height = workspaceView.value?.clientHeight ?? window.innerHeight
  if (target === 'sidebar') return { min: 180, max: Math.min(480, width - (inspectorOpen.value ? inspectorWidth.value : 0) - minimumEditorWidth) }
  if (target === 'inspector') return { min: 220, max: Math.min(480, width - sidebarWidth.value - minimumEditorWidth) }
  return { min: 120, max: Math.min(560, height - 180) }
}
function setResizeValue(target: ResizeTarget, value: number) {
  const limit = resizeLimit(target)
  const next = clamp(value, limit.min, limit.max)
  if (target === 'sidebar') sidebarWidth.value = next
  else if (target === 'inspector') inspectorWidth.value = next
  else bottomPanelHeight.value = next
}
function fitLayoutToViewport() {
  if (!resizeSession) {
    sidebarWidth.value = app.settings.sidebarWidth
    inspectorWidth.value = app.settings.inspectorWidth
    bottomPanelHeight.value = app.settings.bottomPanelHeight
  }
  setResizeValue('sidebar', sidebarWidth.value)
  if (inspectorOpen.value) setResizeValue('inspector', inspectorWidth.value)
  if (panelOpen.value) setResizeValue('panel', bottomPanelHeight.value)
}
function beginResize(target: ResizeTarget, event: PointerEvent) {
  if (event.button !== 0) return
  const startValue = target === 'sidebar' ? sidebarWidth.value : target === 'inspector' ? inspectorWidth.value : bottomPanelHeight.value
  resizeSession = { target, startX: event.clientX, startY: event.clientY, startValue }
  document.body.classList.add(target === 'panel' ? 'workspace-resizing-y' : 'workspace-resizing-x')
  window.addEventListener('pointermove', moveResize)
  window.addEventListener('pointerup', finishResize, { once: true })
  event.preventDefault()
}
function moveResize(event: PointerEvent) {
  if (!resizeSession) return
  const horizontalDelta = event.clientX - resizeSession.startX
  const verticalDelta = event.clientY - resizeSession.startY
  const delta = resizeSession.target === 'sidebar'
    ? horizontalDelta
    : resizeSession.target === 'inspector'
      ? -horizontalDelta
      : -verticalDelta
  setResizeValue(resizeSession.target, resizeSession.startValue + delta)
}
function finishResize() {
  const target = resizeSession?.target
  stopResize()
  if (target) persistResize(target)
}
function stopResize() {
  resizeSession = undefined
  document.body.classList.remove('workspace-resizing-x', 'workspace-resizing-y')
  window.removeEventListener('pointermove', moveResize)
  window.removeEventListener('pointerup', finishResize)
}
function persistResize(target: ResizeTarget) {
  if (target === 'sidebar') void app.updateSettings({ sidebarWidth: sidebarWidth.value })
  else if (target === 'inspector') void app.updateSettings({ inspectorWidth: inspectorWidth.value })
  else void app.updateSettings({ bottomPanelHeight: bottomPanelHeight.value })
}
function resetResize(target: ResizeTarget) {
  setResizeValue(target, target === 'sidebar' ? 260 : target === 'inspector' ? 320 : 190)
  persistResize(target)
}
function resizeWithKeyboard(target: ResizeTarget, event: KeyboardEvent) {
  if (event.key === 'Home') {
    event.preventDefault()
    resetResize(target)
    return
  }
  const step = event.shiftKey ? 32 : 16
  let direction = 0
  if (target === 'panel') {
    if (event.key === 'ArrowUp') direction = 1
    if (event.key === 'ArrowDown') direction = -1
  } else if (target === 'sidebar') {
    if (event.key === 'ArrowRight') direction = 1
    if (event.key === 'ArrowLeft') direction = -1
  } else {
    if (event.key === 'ArrowLeft') direction = 1
    if (event.key === 'ArrowRight') direction = -1
  }
  if (!direction) return
  event.preventDefault()
  const current = target === 'sidebar' ? sidebarWidth.value : target === 'inspector' ? inspectorWidth.value : bottomPanelHeight.value
  setResizeValue(target, current + direction * step)
  persistResize(target)
}

async function switchProject(id: string) {
  if (!id) return
  if (debugState.value && !['exited', 'error'].includes(debugState.value.status)) await debugCommand('stop')
  await store.openProject(id)
  buildResult.value = null
  runResult.value = null
  cmakeResult.value = null
  ctestResult.value = null
  analysisResult.value = null
  diagnostics.value = []
  breakpoints.value = {}
  debugState.value = null
  await router.push(`/workspace/${id}`)
}
function normalizePath(path: string) {
  return path.replaceAll('\\', '/').toLowerCase()
}
function toggleBreakpoint(line: number) {
  if (!active.value) return
  const path = active.value.relativePath
  const current = breakpoints.value[path] ?? []
  breakpoints.value = {
    ...breakpoints.value,
    [path]: current.includes(line) ? current.filter(item => item !== line) : [...current, line].sort((a, b) => a - b)
  }
}
async function showLocation(location: { relativePath: string; line: number; column: number }) {
  if (normalizePath(location.relativePath) !== normalizePath(active.value?.relativePath ?? '')) await store.openFile(location.relativePath)
  diffOpen.value = false
  await nextTick()
  editorHost.value?.reveal(location.line, location.column)
}
function languageFailed(reason: string) {
  languageAvailable.value = false
  languageStatusText.value = reason
}

async function submitAgent(request: AgentStartRequest) {
  agentOpen.value = true
  await agent.start(request)
}

function toggleAgentEntry() {
  if (inboxCount.value) {
    inboxOpen.value = !inboxOpen.value
    return
  }
  agentOpen.value = !agentOpen.value
}

async function navigateInboxOccurrence(occurrence: DiagnosticOccurrence) {
  if (!occurrence.file || !occurrence.line) return
  inboxOpen.value = false
  await showLocation({ relativePath: occurrence.file, line: occurrence.line, column: occurrence.column ?? 1 })
}

async function explainDiagnostic(snapshot: DiagnosticExplanationSnapshot, createNew: boolean) {
  inboxOpen.value = false
  agentOpen.value = true
  if (createNew || !agent.currentConversationId) await agent.createConversation(snapshot.title)
  await agent.sendMessage({
    message: `请结合我的 C++ 学习背景，解释这个错误：${snapshot.title}`,
    diagnostic: snapshot,
    ...(active.value?.relativePath ? { activeFile: active.value.relativePath } : {})
  })
}

async function decideAgent(decision: 'approved' | 'rejected') {
  if (agent.pendingApproval) await agent.decide(agent.pendingApproval.id, decision)
}
async function runSearch() { await store.search(search.value) }
function create(kind: 'file' | 'directory') { Object.assign(entryDialog, { visible: true, mode: 'create', kind, source: '', value: '' }) }
function menu(event: MouseEvent, node: FileTreeNode) {
  contextNode.value = node
  contextPos.value = { x: event.clientX, y: event.clientY }
  void nextTick(() => document.addEventListener('click', closeMenu, { once: true }))
}
function closeMenu() { contextNode.value = null }
function beginEntryAction(mode: 'rename' | 'copy' | 'move') {
  if (!contextNode.value) return
  Object.assign(entryDialog, {
    visible: true,
    mode,
    kind: contextNode.value.kind,
    source: contextNode.value.relativePath,
    value: mode === 'rename' ? contextNode.value.name : contextNode.value.relativePath
  })
  closeMenu()
}
async function remove() { if (contextNode.value) await store.removeEntry(contextNode.value.relativePath); closeMenu() }
async function snapshot() { await store.createSnapshot(snapshotLabel.value || '手动快照'); snapshotLabel.value = '' }
async function submitEntryAction() {
  const value = entryDialog.value.trim()
  if (!value) return
  if (entryDialog.mode === 'create') await store.createEntry(value, entryDialog.kind)
  else if (entryDialog.mode === 'rename') await store.renameEntry(entryDialog.source, value)
  else if (entryDialog.mode === 'copy') await store.copyEntry(entryDialog.source, value)
  else await store.moveEntry(entryDialog.source, value)
  entryDialog.visible = false
}
async function projectCommand(command: 'rename' | 'unregister' | 'delete-files') {
  if (!store.currentProject) return
  if (command === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt('输入新的项目显示名称（不会改动磁盘目录路径）。', '重命名项目', {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: store.currentProject.name,
        inputPattern: /\S+/,
        inputErrorMessage: '名称不能为空',
        inputPlaceholder: '例如：循环练习'
      })
      const renamed = await store.renameProject(store.currentProject.id, value.trim())
      if (renamed) await app.refreshProjects()
    } catch {
      /* cancelled */
    }
    return
  }
  if (command === 'unregister') {
    try {
      await ElMessageBox.confirm('只从应用中移除此项目，磁盘文件保持不变。', '移除项目登记', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' })
    } catch { return }
  }
  clearTimeout(autoSaveTimer)
  const done = await store.removeProject(store.currentProject.id, command === 'delete-files')
  if (done) {
    await app.refreshProjects()
    const next = store.projects[0]
    if (next) await switchProject(next.id)
    else {
      store.currentProject = null
      store.tree = []
      store.tabs = []
      store.activePath = ''
      await router.push('/home')
    }
  }
}
function edit(value: string) {
  const path = active.value?.relativePath
  store.edit(value)
  clearTimeout(autoSaveTimer)
  if (path) autoSaveTimer = setTimeout(() => void store.savePath(path), 1_200)
}
async function saveActive() {
  clearTimeout(autoSaveTimer)
  await store.save()
}
async function build(runAfter = false) {
  const tab = active.value
  const project = store.currentProject
  if (!tab || !project || !canBuild.value) return
  if (tab.conflicted) {
    store.error = { code: 'FILE_REVISION_CONFLICT', message: '当前文件存在外部修改冲突。', retryable: true, userAction: '先在差异视图中选择磁盘版本或当前版本。' }
    return
  }
  await saveActive()
  if (tab.dirty || tab.conflicted) return

  buildResult.value = null
  runResult.value = null
  diagnostics.value = []
  panelOpen.value = true
  panelTab.value = 'output'
  executing.value = 'build'
  currentRunId.value = crypto.randomUUID()
  const result = await window.cppPet.compiler.build({
    runId: currentRunId.value,
    projectId: project.id,
    relativePath: tab.relativePath,
    standard: standard.value
  })
  executing.value = null
  currentRunId.value = ''
  if (!result.ok) { store.error = result.error; return }
  buildResult.value = result.data
  diagnostics.value = result.data.diagnostics
  if (!result.data.success) {
    panelTab.value = result.data.diagnostics.length ? 'problems' : 'output'
    return
  }
  if (runAfter) await runProgram(result.data.buildId)
}
async function runProgram(buildId: string) {
  executing.value = 'run'
  currentRunId.value = crypto.randomUUID()
  const result = await window.cppPet.program.run({
    runId: currentRunId.value,
    buildId,
    input: standardInput.value,
    timeoutMs: 5_000
  })
  executing.value = null
  currentRunId.value = ''
  if (!result.ok) { store.error = result.error; return }
  runResult.value = result.data
  diagnostics.value = [...(buildResult.value?.diagnostics ?? []), ...result.data.diagnostics]
  panelTab.value = result.data.diagnostics.length ? 'problems' : 'output'
}
async function buildCmake() {
  const project = store.currentProject
  if (!project || !canCmake.value) return
  await saveActive()
  if (active.value?.dirty || active.value?.conflicted) return
  cmakeResult.value = null
  ctestResult.value = null
  diagnostics.value = []
  panelOpen.value = true
  panelTab.value = 'output'
  executing.value = 'cmake'
  currentRunId.value = crypto.randomUUID()
  const result = await window.cppPet.cmake.build({
    runId: currentRunId.value,
    projectId: project.id,
    standard: standard.value,
    configuration: 'Debug'
  })
  executing.value = null
  currentRunId.value = ''
  if (!result.ok) { store.error = result.error; return }
  cmakeResult.value = result.data
  diagnostics.value = result.data.diagnostics
  if (!result.data.success && result.data.diagnostics.length) panelTab.value = 'problems'
}
async function runTests() {
  if (!cmakeResult.value?.success || !canTest.value) return
  ctestResult.value = null
  panelOpen.value = true
  panelTab.value = 'output'
  executing.value = 'ctest'
  currentRunId.value = crypto.randomUUID()
  const result = await window.cppPet.ctest.run({
    runId: currentRunId.value,
    buildId: cmakeResult.value.buildId,
    timeoutMs: 30_000
  })
  executing.value = null
  currentRunId.value = ''
  if (!result.ok) { store.error = result.error; return }
  ctestResult.value = result.data
  diagnostics.value = [...cmakeResult.value.diagnostics, ...result.data.diagnostics]
  if (result.data.diagnostics.length) panelTab.value = 'problems'
}
async function analyze() {
  const tab = active.value
  const project = store.currentProject
  if (!tab || !project || !canAnalyze.value) return
  await saveActive()
  if (tab.dirty || tab.conflicted) return
  analysisResult.value = null
  panelOpen.value = true
  panelTab.value = 'output'
  executing.value = 'analysis'
  currentRunId.value = crypto.randomUUID()
  const result = await window.cppPet.analysis.clangTidy({
    runId: currentRunId.value,
    projectId: project.id,
    relativePath: tab.relativePath,
    standard: standard.value
  })
  executing.value = null
  currentRunId.value = ''
  if (!result.ok) { store.error = result.error; return }
  analysisResult.value = result.data
  diagnostics.value = result.data.diagnostics
  if (result.data.diagnostics.length) panelTab.value = 'problems'
}
async function openVsCode() {
  const project = store.currentProject
  if (!project) return
  const cursor = editorHost.value?.position()
  const result = await window.cppPet.vscode.open({
    projectId: project.id,
    ...(active.value ? { relativePath: active.value.relativePath, line: cursor?.line ?? 1, column: cursor?.column ?? 1 } : {})
  })
  if (!result.ok) store.error = result.error
  else if (!result.data.success) store.error = { code: 'VSCODE_OPEN_FAILED', message: result.data.process.stderr || 'VS Code 未能打开项目。', retryable: true, userAction: '检查 VS Code 的 code 命令是否可用。' }
}
async function stop() {
  if (!currentRunId.value) return
  const result = await window.cppPet.program.stop({ runId: currentRunId.value })
  if (!result.ok) store.error = result.error
}
async function startDebug() {
  const tab = active.value
  const project = store.currentProject
  if (!tab || !project || !canDebug.value) return
  await saveActive()
  if (tab.dirty || tab.conflicted) return
  const activeLines = breakpoints.value[tab.relativePath] ?? []
  const activeBreakpoints = activeLines.map(line => ({ relativePath: tab.relativePath, line }))
  if (!activeBreakpoints.length) {
    const line = editorHost.value?.position().line ?? 1
    toggleBreakpoint(line)
    activeBreakpoints.push({ relativePath: tab.relativePath, line })
  }
  debuggerBusy.value = true
  panelOpen.value = true
  panelTab.value = 'debug'
  const result = await window.cppPet.debug.start({
    projectId: project.id,
    relativePath: tab.relativePath,
    standard: standard.value,
    breakpoints: activeBreakpoints
  })
  debuggerBusy.value = false
  if (!result.ok) {
    store.error = result.error
    return
  }
  debugState.value = result.data
  diagnostics.value = result.data.diagnostics
  if (result.data.status === 'error' && result.data.diagnostics.length) panelTab.value = 'problems'
  if (result.data.location) await showLocation(result.data.location)
}
async function debugCommand(command: DebugCommand) {
  const session = debugState.value
  if (!session || debuggerBusy.value) return
  debuggerBusy.value = true
  const result = await window.cppPet.debug.command({ sessionId: session.sessionId, command })
  debuggerBusy.value = false
  if (!result.ok) {
    store.error = result.error
    return
  }
  debugState.value = result.data
  diagnostics.value = result.data.diagnostics
  if (result.data.location) await showLocation(result.data.location)
}
async function showDiagnostic(item: Diagnostic) {
  if (item.file && item.line) await showLocation({ relativePath: item.file, line: item.line, column: item.column ?? 1 })
}
async function overwriteDisk() {
  if (!active.value) return
  try {
    await ElMessageBox.confirm('将使用当前编辑内容覆盖磁盘上的外部修改，并在覆盖前创建快照。', '解决文件冲突', { confirmButtonText: '覆盖磁盘版本', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  await store.overwriteConflict(active.value.relativePath)
  diffOpen.value = false
}
</script>

<template>
  <div ref="workspaceView" :class="['workspace-view', { 'without-inspector': !inspectorOpen }]" :style="layoutStyle">
    <aside class="workspace-sidebar">
      <div class="sidebar-heading">
        <el-select
          class="project-picker"
          :model-value="store.currentProject?.id"
          placeholder="选择项目"
          :disabled="!store.projects.length"
          @change="switchProject"
        >
          <el-option
            v-for="item in store.projects"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-dropdown v-if="store.currentProject" trigger="click" @command="projectCommand">
          <button class="icon-command" title="项目管理"><MoreHorizontal :size="16" /></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">重命名项目</el-dropdown-item>
              <el-dropdown-item command="unregister" divided>移除项目登记</el-dropdown-item>
              <el-dropdown-item command="delete-files">删除磁盘文件</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="icon-command" title="新建项目" @click="dialog = true"><Plus :size="16" /></button>
      </div>
      <div class="file-search"><Search :size="15" /><input v-model="search" placeholder="搜索文件内容" @keyup.enter="runSearch" /></div>
      <div v-if="store.searchResults.length" class="search-results">
        <button v-for="item in store.searchResults" :key="`${item.relativePath}:${item.line}`" @click="store.openFile(item.relativePath)">
          <strong>{{ item.relativePath }}:{{ item.line }}</strong><span>{{ item.excerpt }}</span>
        </button>
      </div>
      <div class="sidebar-toolbar">
        <span>文件</span>
        <button title="新建文件" @click="create('file')"><FilePlus2 :size="15" /></button>
        <button title="新建目录" @click="create('directory')"><FolderPlus :size="15" /></button>
        <button title="刷新" @click="store.refreshTree"><RotateCcw :size="15" /></button>
      </div>
      <FileTree :nodes="store.tree" :active-path="store.activePath" @open="store.openFile" @menu="menu" />
      <div v-if="!store.currentProject" class="sidebar-empty">选择或新建项目</div>
    </aside>
    <div
      class="workspace-resizer workspace-resizer-sidebar"
      role="separator"
      aria-label="调整文件侧边栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="sidebarWidth"
      aria-valuemin="180"
      aria-valuemax="480"
      tabindex="0"
      title="拖动调整文件侧边栏宽度，双击恢复默认"
      @pointerdown="beginResize('sidebar', $event)"
      @dblclick="resetResize('sidebar')"
      @keydown="resizeWithKeyboard('sidebar', $event)"
    />

    <section class="editor-area">
      <div class="editor-tabs">
        <button v-for="tab in store.tabs" :key="tab.relativePath" :class="{ active: store.activePath === tab.relativePath }" @click="store.activePath = tab.relativePath">
          <i v-if="tab.dirty" />{{ tab.relativePath.split(/[\\/]/).at(-1) }}<X :size="13" @click.stop="store.closeTab(tab.relativePath)" />
        </button>
        <span class="tabs-spacer" />
        <button class="save-command" :disabled="!active?.dirty || store.saving || active?.conflicted" title="保存" @click="saveActive"><Save :size="15" />{{ store.saving ? '保存中' : '保存' }}</button>
        <button class="icon-command" title="快照" @click="inspectorOpen = !inspectorOpen"><History :size="16" /></button>
      </div>

      <div class="editor-toolbar">
        <button class="tool-command" :disabled="!canBuild" title="编译当前 C++ 文件" @click="build(false)"><Hammer :size="15" />编译</button>
        <button class="tool-command run" :disabled="!canBuild" title="编译并运行当前 C++ 文件" @click="build(true)"><Play :size="15" />运行</button>
        <button class="tool-command stop" :disabled="!executing" title="停止当前任务" @click="stop"><Square :size="14" />停止</button>
        <span class="toolbar-separator" />
        <button class="tool-command" :disabled="!canCmake" title="配置并构建 CMake 项目" @click="buildCmake"><Boxes :size="15" />工程构建</button>
        <button class="tool-command" :disabled="!canTest" title="运行最近一次 CMake 构建中的 CTest" @click="runTests"><CheckCheck :size="15" />测试</button>
        <button class="tool-command" :disabled="!canAnalyze" title="使用 clang-tidy 分析当前文件" @click="analyze"><ScanSearch :size="15" />分析</button>
        <button class="icon-command external-editor-command" :disabled="!store.currentProject" title="在新的 VS Code 窗口中打开当前文件和光标位置" @click="openVsCode"><ExternalLink :size="15" /></button>
        <span class="toolbar-separator" />
        <button v-if="!debugState || ['exited', 'error'].includes(debugState.status)" class="tool-command debug" :disabled="!canDebug" title="使用 GDB 调试当前 C++ 文件" @click="startDebug"><Bug :size="15" />调试</button>
        <template v-else>
          <button class="tool-command debug" :disabled="!canControlDebug" title="继续运行到下一个断点" @click="debugCommand('continue')"><Play :size="14" />继续</button>
          <button class="tool-command" :disabled="!canControlDebug" title="单步跨过" @click="debugCommand('next')"><StepForward :size="14" />跨过</button>
          <button class="tool-command" :disabled="!canControlDebug" title="单步进入函数" @click="debugCommand('step-in')"><ArrowDownToLine :size="14" />进入</button>
          <button class="tool-command" :disabled="!canControlDebug" title="跳出当前函数" @click="debugCommand('step-out')"><ArrowUpFromLine :size="14" />跳出</button>
          <button class="tool-command stop" :disabled="debuggerBusy" title="停止调试" @click="debugCommand('stop')"><Square :size="14" />停止调试</button>
        </template>
        <el-select v-model="standard" class="standard-picker" size="small" title="C++ 标准">
          <el-option label="C++17" value="c++17" />
          <el-option label="C++20" value="c++20" />
          <el-option label="C++23" value="c++23" />
        </el-select>
        <span class="toolbar-separator" />
        <div class="editor-zoom" title="编辑器缩放（Ctrl + 滚轮 / Ctrl + ±Ctrl + -）">
          <button class="icon-command" type="button" title="缩小" :disabled="!active || editorFontSize <= 11" @click="editorHost?.zoomOut()"><ZoomOut :size="15" /></button>
          <button class="editor-zoom-label" type="button" title="重置缩放（Ctrl+0）" :disabled="!active" @click="editorHost?.zoomReset()">{{ Math.round(editorFontSize / 13 * 100) }}%</button>
          <button class="icon-command" type="button" title="放大" :disabled="!active || editorFontSize >= 28" @click="editorHost?.zoomIn()"><ZoomIn :size="15" /></button>
        </div>
        <span class="toolbar-status" :title="languageStatusText">{{ debuggerBusy ? '调试器正在执行…' : debugState?.status === 'stopped' ? `调试暂停：${debugState.reason ?? '断点'}` : executing === 'build' ? '正在编译…' : executing === 'run' ? '程序正在运行…' : executing === 'cmake' ? '正在构建工程…' : executing === 'ctest' ? '正在运行测试…' : executing === 'analysis' ? '正在静态分析…' : active?.dirty ? '等待自动保存' : active ? `${languageAvailable ? 'clangd 已连接' : '基础编辑模式'} · 已保存` : '' }}</span>
        <button class="panel-toggle" @click="panelOpen = !panelOpen"><Terminal :size="15" />{{ panelOpen ? '隐藏面板' : '显示面板' }}</button>
        <button
          data-tour="workspace-agent-toggle"
          :class="['panel-toggle agent-toggle', { active: agentOpen || inboxOpen, attention: agent.inbox?.attention }]"
          @click="toggleAgentEntry"
        ><Bot :size="15" />Agent<span v-if="inboxCount" class="agent-inbox-badge">{{ diagnosticBadgeLabel(inboxCount) }}</span></button>
      </div>

      <DiagnosticInboxPopover
        v-if="inboxOpen && inboxCount"
        :groups="inboxGroups"
        @acknowledge="agent.acknowledgeInbox()"
        @close="inboxOpen = false"
        @navigate="navigateInboxOccurrence"
        @explain="explainDiagnostic"
      />

      <div v-if="active?.conflicted" class="conflict-band">
        <AlertCircle :size="15" /><span>磁盘版本已变化，当前未保存内容尚未覆盖。</span>
        <button @click="diffOpen = !diffOpen">{{ diffOpen ? '返回编辑器' : '查看差异' }}</button>
        <button @click="store.reloadTab(active.relativePath); diffOpen = false">使用磁盘版本</button>
        <button class="danger" @click="overwriteDisk">覆盖磁盘版本</button>
      </div>

      <div class="editor-surface">
        <DiffEditorHost
          v-if="active && diffOpen && active.conflictDocument"
          :relative-path="active.relativePath"
          :original="active.conflictDocument.content"
          :modified="active.draft"
          :font-size="editorFontSize"
          @change="edit"
        />
        <EditorHost
          v-else-if="active"
          ref="editorHost"
          :document-key="`${active.projectId}:${active.relativePath}`"
          :project-id="active.projectId"
          :relative-path="active.relativePath"
          :value="active.draft"
          :read-only="active.readOnly"
          :diagnostics="allDiagnostics"
          :language-enabled="languageAvailable"
          :breakpoints="currentBreakpoints"
          :debug-line="currentDebugLine"
          :font-size="editorFontSize"
          @change="edit"
          @save="saveActive"
          @definition="showLocation"
          @toggle-breakpoint="toggleBreakpoint"
          @language-failed="languageFailed"
          @font-size-change="editorFontSize = $event"
          @selection="agentSelection = $event"
        />
        <div v-else class="editor-empty">
          <div class="cpp-glyph">C++</div>
          <strong>{{ store.currentProject ? '打开一个文件开始编辑' : '选择学习项目' }}</strong>
          <span>{{ store.currentProject ? 'Monaco 编辑器会保留标签页、自动保存和文件版本冲突状态。' : '项目、文件和快照都限制在授权工作区内。' }}</span>
          <button v-if="!store.currentProject" class="primary-command" @click="dialog = true">新建项目</button>
        </div>
      </div>

      <ConversationPanel
        v-if="agentOpen"
        data-tour="workspace-agent-panel"
        :project-id="store.currentProject?.id"
        :active-file="active?.relativePath"
        :selection="agentSelection"
        :diagnostics="activeDiagnostics"
        :tool-busy="agentRunning || agent.running"
        :tool-status="agent.currentRun?.status"
        @close="agentOpen = false"
        @tool-submit="submitAgent"
        @cancel-tool="agent.currentRun && agent.cancel(agent.currentRun.id)"
      >
        <template v-if="agent.pendingApproval || agent.currentRun" #tool-status>
          <ApprovalCard v-if="agent.pendingApproval" :approval="agent.pendingApproval" :busy="agent.running" @decide="decideAgent" />
          <div v-else-if="agent.currentRun" class="workspace-agent-evidence">
            <RunTimeline :events="agentTimeline" />
            <p v-if="agent.currentRun.response">{{ agent.currentRun.response }}</p>
          </div>
        </template>
      </ConversationPanel>

      <div
        v-if="panelOpen"
        class="workspace-resizer workspace-resizer-panel"
        role="separator"
        aria-label="调整底部面板高度"
        aria-orientation="horizontal"
        :aria-valuenow="bottomPanelHeight"
        aria-valuemin="120"
        aria-valuemax="560"
        tabindex="0"
        title="拖动调整输出面板高度，双击恢复默认"
        @pointerdown="beginResize('panel', $event)"
        @dblclick="resetResize('panel')"
        @keydown="resizeWithKeyboard('panel', $event)"
      />
      <section v-if="panelOpen" class="bottom-panel">
        <header>
          <button :class="{ active: panelTab === 'output' }" @click="panelTab = 'output'">输出</button>
          <button :class="{ active: panelTab === 'problems' }" @click="panelTab = 'problems'">问题 <span v-if="allDiagnostics.length">{{ allDiagnostics.length }}</span></button>
          <button :class="{ active: panelTab === 'debug' }" @click="panelTab = 'debug'">调试</button>
          <div class="run-input"><label for="program-input">程序输入</label><textarea id="program-input" v-model="standardInput" rows="1" placeholder="可选标准输入" /></div>
          <button class="icon-command" title="关闭面板" @click="panelOpen = false"><X :size="14" /></button>
        </header>
        <pre v-if="panelTab === 'output'" class="process-output">{{ outputText }}</pre>
        <div v-else-if="panelTab === 'problems'" class="diagnostic-list">
          <button v-for="(item, index) in allDiagnostics" :key="`${item.source}:${item.file}:${item.line}:${index}`" @click="showDiagnostic(item)">
            <AlertCircle :size="14" :class="item.severity" />
            <span>{{ item.normalizedMessage }}</span>
            <small>{{ item.file || item.source }}<template v-if="item.line">:{{ item.line }}<template v-if="item.column">:{{ item.column }}</template></template></small>
          </button>
          <div v-if="!allDiagnostics.length" class="panel-empty">没有编译、运行或语言服务问题。</div>
        </div>
        <div v-else class="debug-panel">
          <div class="debug-summary">
            <Bug :size="15" />
            <strong>{{ !debugState ? '尚未启动调试' : debugState.status === 'stopped' ? '已暂停' : debugState.status === 'exited' ? '已结束' : debugState.status === 'error' ? '调试失败' : '正在运行' }}</strong>
            <span>{{ debugState?.reason ?? '点击编辑器左侧槽位设置断点，然后启动调试。' }}</span>
          </div>
          <section>
            <h3>局部变量</h3>
            <div class="debug-table">
              <div v-for="item in debugState?.variables ?? []" :key="item.name"><strong>{{ item.name }}</strong><code>{{ item.value }}</code><small>{{ item.type ?? '' }}</small></div>
              <p v-if="!debugState?.variables.length">当前没有可显示的局部变量。</p>
            </div>
          </section>
          <section>
            <h3>调用栈</h3>
            <div class="debug-stack">
              <button
                v-for="frame in debugState?.frames ?? []"
                :key="`${frame.level}:${frame.functionName}:${frame.line}`"
                :disabled="!frame.relativePath || !frame.line"
                @click="frame.relativePath && frame.line && showLocation({ relativePath: frame.relativePath, line: frame.line, column: 1 })"
              >
                <CornerDownRight :size="13" /><strong>#{{ frame.level }} {{ frame.functionName }}</strong><span>{{ frame.relativePath }}<template v-if="frame.line">:{{ frame.line }}</template></span>
              </button>
              <p v-if="!debugState?.frames.length">调试暂停后会显示调用栈。</p>
            </div>
          </section>
          <pre class="debug-output">{{ debugState?.output || '暂无调试器输出。' }}</pre>
        </div>
      </section>
    </section>

    <div
      v-if="inspectorOpen"
      class="workspace-resizer workspace-resizer-inspector"
      role="separator"
      aria-label="调整快照侧边栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="inspectorWidth"
      aria-valuemin="220"
      aria-valuemax="480"
      tabindex="0"
      title="拖动调整快照侧边栏宽度，双击恢复默认"
      @pointerdown="beginResize('inspector', $event)"
      @dblclick="resetResize('inspector')"
      @keydown="resizeWithKeyboard('inspector', $event)"
    />
    <aside v-if="inspectorOpen" class="workspace-inspector">
      <header><div><Camera :size="17" /><strong>快照</strong></div><button class="icon-command" @click="inspectorOpen = false"><X :size="15" /></button></header>
      <div class="snapshot-create"><input v-model="snapshotLabel" placeholder="快照标签" /><button @click="snapshot"><Plus :size="15" />创建</button></div>
      <div class="snapshot-list">
        <article v-for="item in store.snapshots" :key="item.id">
          <div><strong>{{ item.label }}</strong><span>{{ item.entries.length }} 个文件 · {{ new Date(item.createdAt).toLocaleString() }}</span></div>
          <button title="恢复快照" @click="store.restoreSnapshot(item.id)"><RotateCcw :size="15" /></button>
          <button title="删除快照" @click="store.removeSnapshot(item.id)"><Trash2 :size="15" /></button>
        </article>
        <div v-if="!store.snapshots.length" class="inspector-empty">保存文件或手动创建快照后，版本记录会显示在这里。</div>
      </div>
      <section class="project-meta" v-if="store.currentProject">
        <h3>项目</h3><dl><div><dt>类型</dt><dd>{{ store.currentProject.type }}</dd></div><div><dt>来源</dt><dd>{{ store.currentProject.creationMode }}</dd></div><div><dt>Root</dt><dd>{{ store.currentProject.relativeRoot }}</dd></div></dl>
      </section>
    </aside>

    <div v-if="contextNode" class="context-menu" :style="{ left: `${contextPos.x}px`, top: `${contextPos.y}px` }">
      <button @click="beginEntryAction('rename')"><Pencil :size="14" />重命名</button>
      <button @click="beginEntryAction('copy')"><Copy :size="14" />复制到</button>
      <button @click="beginEntryAction('move')"><Move :size="14" />移动到</button>
      <button class="danger" @click="remove"><Trash2 :size="14" />删除</button>
    </div>
    <el-dialog v-model="entryDialog.visible" width="430" :title="entryDialog.mode === 'create' ? (entryDialog.kind === 'file' ? '新建文件' : '新建目录') : entryDialog.mode === 'rename' ? '重命名' : entryDialog.mode === 'copy' ? '复制到' : '移动到'" @closed="entryDialog.value = ''">
      <label class="dialog-field-label">{{ entryDialog.mode === 'rename' ? '新名称' : '项目内相对路径' }}</label>
      <el-input v-model="entryDialog.value" autofocus @keyup.enter="submitEntryAction" />
      <template #footer><el-button @click="entryDialog.visible = false">取消</el-button><el-button type="primary" :disabled="!entryDialog.value.trim()" @click="submitEntryAction">确认</el-button></template>
    </el-dialog>
    <ProjectDialog v-model="dialog" @created="project => switchProject(project.id)" />
  </div>
</template>
