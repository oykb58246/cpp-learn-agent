<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Camera, Copy, FilePlus2, FolderPlus, History, MoreHorizontal, Move, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-vue-next'
import { ElMessageBox } from 'element-plus'
import type { FileTreeNode } from '@cpp-pet/contracts'
import FileTree from '../components/FileTree.vue'
import ProjectDialog from '../components/ProjectDialog.vue'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore(); const route = useRoute(); const router = useRouter(); const dialog = ref(false); const search = ref(''); const snapshotLabel = ref(''); const inspectorOpen = ref(true); const contextNode = ref<FileTreeNode | null>(null); const contextPos = ref({ x: 0, y: 0 })
const active = computed(() => store.activeTab)
const entryDialog = reactive({ visible: false, mode: 'create' as 'create' | 'rename' | 'copy' | 'move', kind: 'file' as 'file' | 'directory', source: '', value: '' })
onMounted(async () => { await store.loadProjects(); const id = route.params.projectId as string | undefined; if (id) await store.openProject(id); else if (store.projects[0]) { await store.openProject(store.projects[0].id); await router.replace(`/workspace/${store.projects[0].id}`) } })
watch(() => route.params.projectId, async id => { if (typeof id === 'string' && id !== store.currentProject?.id) await store.openProject(id) })
async function switchProject(id: string) { await store.openProject(id); await router.push(`/workspace/${id}`) }
async function runSearch() { await store.search(search.value) }
function create(kind: 'file' | 'directory') { Object.assign(entryDialog, { visible: true, mode: 'create', kind, source: '', value: '' }) }
function menu(event: MouseEvent, node: FileTreeNode) { contextNode.value = node; contextPos.value = { x: event.clientX, y: event.clientY }; void nextTick(() => document.addEventListener('click', closeMenu, { once: true })) }
function closeMenu() { contextNode.value = null }
function beginEntryAction(mode: 'rename' | 'copy' | 'move') { if (!contextNode.value) return; Object.assign(entryDialog, { visible: true, mode, kind: contextNode.value.kind, source: contextNode.value.relativePath, value: mode === 'rename' ? contextNode.value.name : contextNode.value.relativePath }); closeMenu() }
async function remove() { if (contextNode.value) await store.removeEntry(contextNode.value.relativePath); closeMenu() }
async function snapshot() { await store.createSnapshot(snapshotLabel.value || '手动快照'); snapshotLabel.value = '' }
async function submitEntryAction() { const value = entryDialog.value.trim(); if (!value) return; if (entryDialog.mode === 'create') await store.createEntry(value, entryDialog.kind); else if (entryDialog.mode === 'rename') await store.renameEntry(entryDialog.source, value); else if (entryDialog.mode === 'copy') await store.copyEntry(entryDialog.source, value); else await store.moveEntry(entryDialog.source, value); entryDialog.visible = false }
async function projectCommand(command: 'unregister' | 'delete-files') { if (!store.currentProject) return; if (command === 'unregister') { try { await ElMessageBox.confirm('只从应用中移除此项目，磁盘文件保持不变。', '移除项目登记', { confirmButtonText: '移除', cancelButtonText: '取消' }) } catch { return } } const done = await store.removeProject(store.currentProject.id, command === 'delete-files'); if (done) { const next = store.projects[0]; next ? await switchProject(next.id) : await router.push('/workspace') } }
</script>

<template>
  <div class="workspace-view">
    <aside class="workspace-sidebar">
      <div class="sidebar-heading"><select :value="store.currentProject?.id" @change="switchProject(($event.target as HTMLSelectElement).value)"><option value="" disabled>选择项目</option><option v-for="item in store.projects" :key="item.id" :value="item.id">{{ item.name }}</option></select><el-dropdown v-if="store.currentProject" trigger="click" @command="projectCommand"><button class="icon-command" title="项目操作"><MoreHorizontal :size="16" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="unregister">移除项目登记</el-dropdown-item><el-dropdown-item command="delete-files" divided>删除磁盘文件</el-dropdown-item></el-dropdown-menu></template></el-dropdown><button class="icon-command" title="新建项目" @click="dialog = true"><Plus :size="16" /></button></div>
      <div class="file-search"><Search :size="15" /><input v-model="search" placeholder="搜索文件内容" @keyup.enter="runSearch" /></div>
      <div v-if="store.searchResults.length" class="search-results"><button v-for="item in store.searchResults" :key="`${item.relativePath}:${item.line}`" @click="store.openFile(item.relativePath)"><strong>{{ item.relativePath }}:{{ item.line }}</strong><span>{{ item.excerpt }}</span></button></div>
      <div class="sidebar-toolbar"><span>文件</span><button title="新建文件" @click="create('file')"><FilePlus2 :size="15" /></button><button title="新建目录" @click="create('directory')"><FolderPlus :size="15" /></button><button title="刷新" @click="store.refreshTree"><RotateCcw :size="15" /></button></div>
      <FileTree :nodes="store.tree" :active-path="store.activePath" @open="store.openFile" @menu="menu" />
      <div v-if="!store.currentProject" class="sidebar-empty">选择或新建项目</div>
    </aside>
    <section class="editor-area">
      <div class="editor-tabs"><button v-for="tab in store.tabs" :key="tab.relativePath" :class="{ active: store.activePath === tab.relativePath }" @click="store.activePath = tab.relativePath"><i v-if="tab.dirty" />{{ tab.relativePath.split(/[\\/]/).at(-1) }}<X :size="13" @click.stop="store.closeTab(tab.relativePath)" /></button><span class="tabs-spacer" /><button class="save-command" :disabled="!active?.dirty || store.saving" title="保存" @click="store.save"><Save :size="15" />{{ store.saving ? '保存中' : '保存' }}</button><button class="icon-command" title="快照" @click="inspectorOpen = !inspectorOpen"><History :size="16" /></button></div>
      <div v-if="active?.conflicted" class="conflict-band"><span>磁盘版本已变化，当前编辑内容尚未覆盖。</span><button @click="store.reloadTab(active.relativePath)">重新加载磁盘版本</button></div>
      <textarea v-if="active" class="basic-editor" :value="active.draft" spellcheck="false" @input="store.edit(($event.target as HTMLTextAreaElement).value)" @keydown.ctrl.s.prevent="store.save" />
      <div v-else class="editor-empty"><div class="cpp-glyph">C++</div><strong>{{ store.currentProject ? '打开一个文件开始编辑' : '选择学习项目' }}</strong><span>{{ store.currentProject ? '基础编辑器会保留文件哈希和快照，成员 B 可直接替换为 Monaco。' : '项目、文件和快照都限制在授权工作区内。' }}</span><button v-if="!store.currentProject" class="primary-command" @click="dialog = true">新建项目</button></div>
    </section>
    <aside v-if="inspectorOpen" class="workspace-inspector"><header><div><Camera :size="17" /><strong>快照</strong></div><button class="icon-command" @click="inspectorOpen = false"><X :size="15" /></button></header><div class="snapshot-create"><input v-model="snapshotLabel" placeholder="快照标签" /><button @click="snapshot"><Plus :size="15" />创建</button></div><div class="snapshot-list"><article v-for="item in store.snapshots" :key="item.id"><div><strong>{{ item.label }}</strong><span>{{ item.entries.length }} 个文件 · {{ new Date(item.createdAt).toLocaleString() }}</span></div><button title="恢复快照" @click="store.restoreSnapshot(item.id)"><RotateCcw :size="15" /></button><button title="删除快照" @click="store.removeSnapshot(item.id)"><Trash2 :size="15" /></button></article><div v-if="!store.snapshots.length" class="inspector-empty">保存文件或手动创建快照后，版本记录会显示在这里。</div></div><section class="project-meta" v-if="store.currentProject"><h3>项目</h3><dl><div><dt>类型</dt><dd>{{ store.currentProject.type }}</dd></div><div><dt>来源</dt><dd>{{ store.currentProject.creationMode }}</dd></div><div><dt>Root</dt><dd>{{ store.currentProject.relativeRoot }}</dd></div></dl></section></aside>
    <div v-if="contextNode" class="context-menu" :style="{ left: `${contextPos.x}px`, top: `${contextPos.y}px` }"><button @click="beginEntryAction('rename')"><Pencil :size="14" />重命名</button><button @click="beginEntryAction('copy')"><Copy :size="14" />复制到</button><button @click="beginEntryAction('move')"><Move :size="14" />移动到</button><button class="danger" @click="remove"><Trash2 :size="14" />删除</button></div>
    <el-dialog v-model="entryDialog.visible" width="430" :title="entryDialog.mode === 'create' ? (entryDialog.kind === 'file' ? '新建文件' : '新建目录') : entryDialog.mode === 'rename' ? '重命名' : entryDialog.mode === 'copy' ? '复制到' : '移动到'" @closed="entryDialog.value = ''"><label class="dialog-field-label">{{ entryDialog.mode === 'rename' ? '新名称' : '项目内相对路径' }}</label><el-input v-model="entryDialog.value" autofocus @keyup.enter="submitEntryAction" /><template #footer><el-button @click="entryDialog.visible = false">取消</el-button><el-button type="primary" :disabled="!entryDialog.value.trim()" @click="submitEntryAction">确认</el-button></template></el-dialog>
    <ProjectDialog v-model="dialog" @created="project => switchProject(project.id)" />
  </div>
</template>
