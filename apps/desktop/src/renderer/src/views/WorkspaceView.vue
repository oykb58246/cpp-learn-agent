<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  Camera,
  Copy,
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
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-vue-next'
import { ElMessageBox } from 'element-plus'
import type { BuildResult, Diagnostic, FileTreeNode, ProgramRunResult } from '@cpp-pet/contracts'
import DiffEditorHost from '../components/DiffEditorHost.vue'
import EditorHost from '../components/EditorHost.vue'
import FileTree from '../components/FileTree.vue'
import ProjectDialog from '../components/ProjectDialog.vue'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const route = useRoute()
const router = useRouter()
const dialog = ref(false)
const search = ref('')
const snapshotLabel = ref('')
const inspectorOpen = ref(true)
const contextNode = ref<FileTreeNode | null>(null)
const contextPos = ref({ x: 0, y: 0 })
const active = computed(() => store.activeTab)
const editorHost = ref<InstanceType<typeof EditorHost> | null>(null)
const diffOpen = ref(false)
const panelOpen = ref(true)
const panelTab = ref<'output' | 'problems'>('output')
const standard = ref<'c++17' | 'c++20' | 'c++23'>('c++17')
const standardInput = ref('')
const executing = ref<'build' | 'run' | null>(null)
const currentRunId = ref('')
const buildResult = ref<BuildResult | null>(null)
const runResult = ref<ProgramRunResult | null>(null)
const diagnostics = ref<Diagnostic[]>([])
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined

const entryDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'rename' | 'copy' | 'move',
  kind: 'file' as 'file' | 'directory',
  source: '',
  value: ''
})
const canBuild = computed(() => Boolean(active.value && /\.(?:cpp|cc|cxx)$/i.test(active.value.relativePath) && !executing.value))
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
  return chunks.join('\n\n') || '尚未执行编译或运行。'
})

onMounted(async () => {
  await store.loadProjects()
  const id = route.params.projectId as string | undefined
  if (id) await store.openProject(id)
  else if (store.projects[0]) {
    await store.openProject(store.projects[0].id)
    await router.replace(`/workspace/${store.projects[0].id}`)
  }
})
onBeforeUnmount(() => clearTimeout(autoSaveTimer))
watch(() => route.params.projectId, async id => {
  if (typeof id === 'string' && id !== store.currentProject?.id) await store.openProject(id)
})
watch(() => active.value?.relativePath, () => { diffOpen.value = false })

async function switchProject(id: string) {
  await store.openProject(id)
  buildResult.value = null
  runResult.value = null
  diagnostics.value = []
  await router.push(`/workspace/${id}`)
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
async function projectCommand(command: 'unregister' | 'delete-files') {
  if (!store.currentProject) return
  if (command === 'unregister') {
    try {
      await ElMessageBox.confirm('只从应用中移除此项目，磁盘文件保持不变。', '移除项目登记', { confirmButtonText: '移除', cancelButtonText: '取消' })
    } catch { return }
  }
  const done = await store.removeProject(store.currentProject.id, command === 'delete-files')
  if (done) {
    const next = store.projects[0]
    next ? await switchProject(next.id) : await router.push('/workspace')
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
async function stop() {
  if (!currentRunId.value) return
  const result = await window.cppPet.program.stop({ runId: currentRunId.value })
  if (!result.ok) store.error = result.error
}
async function showDiagnostic(item: Diagnostic) {
  if (item.file && item.file !== active.value?.relativePath) await store.openFile(item.file)
  diffOpen.value = false
  await nextTick()
  if (item.line) editorHost.value?.reveal(item.line, item.column)
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
  <div :class="['workspace-view', { 'without-inspector': !inspectorOpen }]">
    <aside class="workspace-sidebar">
      <div class="sidebar-heading">
        <select :value="store.currentProject?.id" @change="switchProject(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>选择项目</option>
          <option v-for="item in store.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <el-dropdown v-if="store.currentProject" trigger="click" @command="projectCommand">
          <button class="icon-command" title="项目操作"><MoreHorizontal :size="16" /></button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="unregister">移除项目登记</el-dropdown-item><el-dropdown-item command="delete-files" divided>删除磁盘文件</el-dropdown-item></el-dropdown-menu></template>
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
        <select v-model="standard" class="standard-select" title="C++ 标准"><option value="c++17">C++17</option><option value="c++20">C++20</option><option value="c++23">C++23</option></select>
        <span class="toolbar-status">{{ executing === 'build' ? '正在编译…' : executing === 'run' ? '程序正在运行…' : active?.dirty ? '等待自动保存' : active ? '已保存' : '' }}</span>
        <button class="panel-toggle" @click="panelOpen = !panelOpen"><Terminal :size="15" />{{ panelOpen ? '隐藏面板' : '显示面板' }}</button>
      </div>

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
          @change="edit"
        />
        <EditorHost
          v-else-if="active"
          ref="editorHost"
          :document-key="`${active.projectId}:${active.relativePath}`"
          :relative-path="active.relativePath"
          :value="active.draft"
          :read-only="active.readOnly"
          :diagnostics="diagnostics"
          @change="edit"
          @save="saveActive"
        />
        <div v-else class="editor-empty">
          <div class="cpp-glyph">C++</div>
          <strong>{{ store.currentProject ? '打开一个文件开始编辑' : '选择学习项目' }}</strong>
          <span>{{ store.currentProject ? 'Monaco 编辑器会保留标签页、自动保存和文件版本冲突状态。' : '项目、文件和快照都限制在授权工作区内。' }}</span>
          <button v-if="!store.currentProject" class="primary-command" @click="dialog = true">新建项目</button>
        </div>
      </div>

      <section v-if="panelOpen" class="bottom-panel">
        <header>
          <button :class="{ active: panelTab === 'output' }" @click="panelTab = 'output'">输出</button>
          <button :class="{ active: panelTab === 'problems' }" @click="panelTab = 'problems'">问题 <span v-if="diagnostics.length">{{ diagnostics.length }}</span></button>
          <div class="run-input"><label for="program-input">程序输入</label><textarea id="program-input" v-model="standardInput" rows="1" placeholder="可选标准输入" /></div>
          <button class="icon-command" title="关闭面板" @click="panelOpen = false"><X :size="14" /></button>
        </header>
        <pre v-if="panelTab === 'output'" class="process-output">{{ outputText }}</pre>
        <div v-else class="diagnostic-list">
          <button v-for="(item, index) in diagnostics" :key="`${item.source}:${item.file}:${item.line}:${index}`" @click="showDiagnostic(item)">
            <AlertCircle :size="14" :class="item.severity" />
            <span>{{ item.normalizedMessage }}</span>
            <small>{{ item.file || item.source }}<template v-if="item.line">:{{ item.line }}<template v-if="item.column">:{{ item.column }}</template></template></small>
          </button>
          <div v-if="!diagnostics.length" class="panel-empty">没有编译或运行问题。</div>
        </div>
      </section>
    </section>

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
