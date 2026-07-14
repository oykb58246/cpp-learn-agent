import { defineStore } from 'pinia'
import { ElMessageBox } from 'element-plus'
import type { AppError, FileDocument, FileTreeNode, Project, ProjectDraft, ProjectDraftInput, SearchResult, SnapshotManifest } from '@cpp-pet/contracts'

export interface OpenTab extends FileDocument { draft: string; dirty: boolean; conflicted: boolean; conflictDocument?: FileDocument }
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({ projects: [] as Project[], currentProject: null as Project | null, tree: [] as FileTreeNode[], tabs: [] as OpenTab[], activePath: '', snapshots: [] as SnapshotManifest[], searchResults: [] as SearchResult[], loading: false, saving: false, error: null as AppError | null }),
  getters: { activeTab: state => state.tabs.find(x => x.relativePath === state.activePath) ?? null },
  actions: {
    async loadProjects() { const result = await window.cppPet.project.list(); if (result.ok) this.projects = result.data; else this.error = result.error },
    async openProject(id: string) { this.loading = true; const switching = this.currentProject?.id !== id; const result = await window.cppPet.project.open({ projectId: id }); if (result.ok) { if (switching) { this.tabs = []; this.activePath = ''; this.searchResults = [] } this.currentProject = result.data; await Promise.all([this.refreshTree(), this.refreshSnapshots()]) } else this.error = result.error; this.loading = false },
    async refreshTree() { if (!this.currentProject) return; const result = await window.cppPet.files.listTree({ projectId: this.currentProject.id }); if (result.ok) this.tree = result.data; else this.error = result.error },
    async openFile(relativePath: string) {
      if (!this.currentProject) return
      const old = this.tabs.find(x => x.relativePath === relativePath); if (old) { this.activePath = relativePath; return }
      const result = await window.cppPet.files.read({ projectId: this.currentProject.id, relativePath })
      if (result.ok) { this.tabs.push({ ...result.data, draft: result.data.content, dirty: false, conflicted: false }); this.activePath = relativePath } else this.error = result.error
    },
    edit(content: string) { const tab = this.activeTab; if (tab) { tab.draft = content; tab.dirty = tab.draft !== tab.content } },
    async save() { if (this.activePath) await this.savePath(this.activePath) },
    async savePath(path: string) {
      const tab = this.tabs.find(item => item.relativePath === path); if (!tab || !tab.dirty || tab.conflicted) return
      this.saving = true
      const result = await window.cppPet.files.write({ projectId: tab.projectId, relativePath: tab.relativePath, content: tab.draft, expectedHash: tab.contentHash, createSnapshot: true })
      if (result.ok) Object.assign(tab, result.data, { draft: result.data.content, dirty: false, conflicted: false, conflictDocument: undefined })
      else { this.error = result.error; if (result.error.code === 'FILE_REVISION_CONFLICT') tab.conflicted = true }
      this.saving = false; await this.refreshSnapshots()
    },
    async closeTab(path: string) { const tab = this.tabs.find(x => x.relativePath === path); if (tab?.dirty) { try { await ElMessageBox.confirm('当前修改尚未保存，关闭后将丢失。', '关闭文件', { confirmButtonText: '关闭', cancelButtonText: '返回编辑', type: 'warning' }) } catch { return } } this.tabs = this.tabs.filter(x => x.relativePath !== path); if (this.activePath === path) this.activePath = this.tabs.at(-1)?.relativePath ?? '' },
    async createEntry(path: string, kind: 'file' | 'directory') { if (!this.currentProject) return; const result = await window.cppPet.files.create({ projectId: this.currentProject.id, relativePath: path, kind }); result.ok ? await this.refreshTree() : this.error = result.error },
    async copyEntry(path: string, destination: string) { if (!this.currentProject) return; const result = await window.cppPet.files.copy({ projectId: this.currentProject.id, relativePath: path, destination }); result.ok ? await this.refreshTree() : this.error = result.error },
    async moveEntry(path: string, destination: string) { if (!this.currentProject) return; const result = await window.cppPet.files.move({ projectId: this.currentProject.id, relativePath: path, destination }); result.ok ? await this.refreshTree() : this.error = result.error },
    async renameEntry(path: string, nextName: string) { if (!this.currentProject) return; const result = await window.cppPet.files.rename({ projectId: this.currentProject.id, relativePath: path, nextName }); result.ok ? await this.refreshTree() : this.error = result.error },
    async removeEntry(path: string) { if (!this.currentProject) return; const result = await window.cppPet.files.remove({ projectId: this.currentProject.id, relativePath: path }); result.ok ? await Promise.all([this.refreshTree(), this.refreshSnapshots()]) : this.error = result.error },
    async search(query: string) { if (!this.currentProject) return; const result = await window.cppPet.files.search({ projectId: this.currentProject.id, query }); if (result.ok) this.searchResults = result.data; else this.error = result.error },
    async createSnapshot(label: string) { if (!this.currentProject) return; const result = await window.cppPet.snapshots.create({ projectId: this.currentProject.id, label }); result.ok ? await this.refreshSnapshots() : this.error = result.error },
    async refreshSnapshots() { if (!this.currentProject) return; const result = await window.cppPet.snapshots.list({ projectId: this.currentProject.id }); if (result.ok) this.snapshots = result.data; else this.error = result.error },
    async restoreSnapshot(id: string) { const result = await window.cppPet.snapshots.restore({ snapshotId: id }); if (result.ok) { this.tabs = []; this.activePath = ''; await Promise.all([this.refreshTree(), this.refreshSnapshots()]) } else this.error = result.error },
    async removeSnapshot(id: string) { const result = await window.cppPet.snapshots.remove({ snapshotId: id }); result.ok ? await this.refreshSnapshots() : this.error = result.error },
    async preview(input: ProjectDraftInput): Promise<ProjectDraft | null> { const result = await window.cppPet.project.preview(input); if (result.ok) return result.data; this.error = result.error; return null },
    async commit(draftId: string): Promise<Project | null> { const result = await window.cppPet.project.create({ draftId }); if (!result.ok) { this.error = result.error; return null } await this.loadProjects(); return result.data },
    async importPreview(): Promise<ProjectDraft | null> { const result = await window.cppPet.project.previewImport(); if (result.ok) return result.data; this.error = result.error; return null },
    async commitImport(draftId: string): Promise<Project | null> { const result = await window.cppPet.project.import({ draftId }); if (!result.ok) { this.error = result.error; return null } await this.loadProjects(); return result.data },
    async removeProject(projectId: string, deleteFiles: boolean) { const result = await window.cppPet.project.remove({ projectId, deleteFiles }); if (!result.ok) { this.error = result.error; return false } this.tabs = []; this.activePath = ''; if (this.currentProject?.id === projectId) this.currentProject = null; await this.loadProjects(); return true },
    handleExternal(event: { projectId?: string; relativePath?: string }) {
      if (event.projectId !== this.currentProject?.id) return
      void this.refreshTree()
      const tab = this.tabs.find(x => x.relativePath === event.relativePath)
      if (!tab) return
      if (!tab.dirty) { void this.reloadTab(tab.relativePath); return }
      void this.loadConflict(tab.relativePath)
    },
    async loadConflict(path: string) {
      const tab = this.tabs.find(x => x.relativePath === path); if (!tab || !this.currentProject) return
      const result = await window.cppPet.files.read({ projectId: this.currentProject.id, relativePath: path })
      if (result.ok) { tab.conflicted = true; tab.conflictDocument = result.data } else this.error = result.error
    },
    async reloadTab(path: string) {
      const tab = this.tabs.find(x => x.relativePath === path); if (!tab || !this.currentProject) return
      const document = tab.conflictDocument
      if (document) { Object.assign(tab, document, { draft: document.content, dirty: false, conflicted: false, conflictDocument: undefined }); return }
      const result = await window.cppPet.files.read({ projectId: this.currentProject.id, relativePath: path })
      if (result.ok) Object.assign(tab, result.data, { draft: result.data.content, dirty: false, conflicted: false, conflictDocument: undefined })
      else this.error = result.error
    },
    async overwriteConflict(path: string) {
      const tab = this.tabs.find(x => x.relativePath === path)
      const disk = tab?.conflictDocument
      if (!tab || !disk) return
      Object.assign(tab, disk, { draft: tab.draft, dirty: tab.draft !== disk.content, conflicted: false, conflictDocument: undefined })
      await this.savePath(path)
    }
  }
})
