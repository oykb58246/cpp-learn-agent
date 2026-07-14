import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { createGzip, createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import type { FileDocument, FileTreeNode, Project, ProjectDraft, ProjectDraftInput, RestorePreview, SearchResult, SnapshotManifest, Workspace } from '@cpp-pet/contracts'
import type { AppDatabase, SnapshotRecord } from '@cpp-pet/database'
import { watch } from 'chokidar'

export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly userAction: string, readonly retryable = false) { super(message) }
}

const forbiddenNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
export function safePath(root: string, relativePath: string, allowMissing = true): string {
  if (!relativePath || relativePath.includes('\0') || isAbsolute(relativePath)) throw new DomainError('WS_PATH_OUTSIDE_ROOT', '路径必须是项目内的相对路径。', '请选择项目中的文件。')
  const segments = relativePath.replaceAll('\\', '/').split('/')
  if (segments.some(x => x === '..' || forbiddenNames.test(x))) throw new DomainError('WS_PATH_OUTSIDE_ROOT', '路径包含不允许的片段。', '请修改文件名或路径。')
  const rootReal = realpathSync(root); const candidate = resolve(rootReal, normalize(relativePath))
  const rel = relative(rootReal, candidate)
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new DomainError('WS_PATH_OUTSIDE_ROOT', '路径越出了工作区。', '请仅操作当前项目文件。')
  let cursor = candidate
  while (!existsSync(cursor)) { const parent = dirname(cursor); if (parent === cursor) break; cursor = parent }
  if (!allowMissing && !existsSync(candidate)) throw new DomainError('FILE_NOT_FOUND', '文件不存在。', '刷新文件树后重试。')
  const cursorReal = realpathSync(cursor); const realRel = relative(rootReal, cursorReal)
  if (realRel.startsWith(`..${sep}`) || realRel === '..' || isAbsolute(realRel)) throw new DomainError('WS_PATH_OUTSIDE_ROOT', '符号链接指向了工作区外。', '移除该链接后重试。')
  return candidate
}

export const contentHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const editable = (name: string) => /(?:\.(?:cpp|cc|cxx|h|hpp|txt|md|json|cmake)|CMakeLists\.txt)$/i.test(name)
const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'out'])

export class WorkspaceService {
  private drafts = new Map<string, ProjectDraft>()
  constructor(readonly db: AppDatabase, readonly snapshotRoot: string) { mkdirSync(snapshotRoot, { recursive: true }) }

  registerWorkspace(rootPath: string): Workspace {
    const real = realpathSync(rootPath); const now = new Date().toISOString()
    return this.db.upsertWorkspace({ id: randomUUID(), name: basename(real), rootPath: real, trustState: 'inspection', createdAt: now, lastOpenedAt: now })
  }
  setTrust(id: string, trusted: boolean): Workspace { return this.db.setWorkspaceTrust(id, trusted ? 'trusted' : 'revoked') }

  previewProject(input: ProjectDraftInput): ProjectDraft {
    const workspace = this.requiredWorkspace(input.workspaceId)
    const cleanName = input.name.trim().replace(/[<>:"/\\|?*]/g, '-'); if (!cleanName) throw new DomainError('PROJECT_NAME_INVALID', '项目名称无效。', '请输入有效的项目名称。')
    const files = projectFiles(input.type, input.mode, input.statement, input.description, input.samples)
    const draft: ProjectDraft = { draftId: randomUUID(), mode: input.mode, workspaceId: workspace.id, name: cleanName, type: input.type, relativeRoot: cleanName, proposedFiles: files, ...(input.mode === 'problem' ? { problem: { statement: input.statement ?? '', constraints: input.constraints ?? [], samples: input.samples ?? [] } } : {}), warnings: [] }
    const destination = safePath(workspace.rootPath, cleanName)
    if (existsSync(destination)) draft.warnings.push('目标目录已存在，创建操作将被拒绝；请修改项目名。')
    this.drafts.set(draft.draftId, draft); return draft
  }
  previewImport(sourceDirectory: string): ProjectDraft {
    const source = realpathSync(sourceDirectory); const parent = dirname(source)
    let workspace = this.db.listWorkspaces().find(w => w.rootPath.toLowerCase() === parent.toLowerCase())
    if (!workspace) workspace = this.registerWorkspace(parent)
    const type = existsSync(join(source, 'CMakeLists.txt')) ? 'cmake' : readdirSync(source).filter(x => /\.(?:cpp|h|hpp)$/i.test(x)).length > 1 ? 'multi-file' : 'single-file'
    const draft: ProjectDraft = { draftId: randomUUID(), mode: 'import', workspaceId: workspace.id, name: basename(source), type, relativeRoot: basename(source), proposedFiles: [], sourceDirectory: source, warnings: workspace.trustState === 'trusted' ? [] : ['导入项目当前为只读检查状态，信任工作区后才能修改。'] }
    this.drafts.set(draft.draftId, draft); return draft
  }
  commitDraft(draftId: string): Project {
    const draft = this.drafts.get(draftId); if (!draft?.workspaceId) throw new DomainError('PROJECT_DRAFT_EXPIRED', '项目预览已失效。', '请重新生成项目预览。')
    const workspace = this.requiredWorkspace(draft.workspaceId)
    if (draft.mode !== 'import' && workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区尚未信任。', '先信任工作区再创建项目。')
    const projectRoot = safePath(workspace.rootPath, draft.relativeRoot)
    if (draft.mode !== 'import') {
      if (existsSync(projectRoot)) throw new DomainError('PROJECT_NAME_CONFLICT', '目标目录已经存在。', '修改项目名称后重试。')
      mkdirSync(projectRoot, { recursive: true })
      try { for (const file of draft.proposedFiles) { const path = safePath(projectRoot, file.relativePath); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content, 'utf8') } }
      catch (error) { rmSync(projectRoot, { recursive: true, force: true }); throw error }
    }
    const now = new Date().toISOString(); const problem = draft.problem ? { id: randomUUID(), ...draft.problem, createdAt: now } : undefined
    const project: Project = { id: randomUUID(), workspaceId: workspace.id, name: draft.name, type: draft.type, creationMode: draft.mode, relativeRoot: draft.relativeRoot, ...(problem ? { problemId: problem.id } : {}), createdAt: now, updatedAt: now, lastOpenedAt: now }
    this.db.saveProject(project, problem); this.event('project.created', project.id, { name: project.name, mode: project.creationMode }); this.drafts.delete(draftId); return project
  }

  projectRoot(projectId: string): { project: Project; workspace: Workspace; root: string } {
    const project = this.db.getProject(projectId); if (!project) throw new DomainError('PROJECT_NOT_FOUND', '项目不存在。', '返回项目列表并刷新。')
    const workspace = this.requiredWorkspace(project.workspaceId); const root = safePath(workspace.rootPath, project.relativeRoot, false)
    return { project, workspace, root }
  }
  watchProject(projectId: string, listener: (event: { workspaceId: string; projectId: string; kind: 'created' | 'changed' | 'deleted'; relativePath: string; occurredAt: string }) => void): () => void {
    const { project, workspace, root } = this.projectRoot(projectId)
    const watcher = watch(root, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }, ignored: /(^|[\\/])(\.git|node_modules|build|dist|out|\.cpppet-)/ })
    const emit = (kind: 'created' | 'changed' | 'deleted', path: string) => listener({ workspaceId: workspace.id, projectId: project.id, kind, relativePath: relative(root, path), occurredAt: new Date().toISOString() })
    watcher.on('add', path => emit('created', path)).on('change', path => emit('changed', path)).on('unlink', path => emit('deleted', path)).on('addDir', path => path !== root && emit('created', path)).on('unlinkDir', path => emit('deleted', path))
    return () => { void watcher.close() }
  }
  listTree(projectId: string): FileTreeNode[] { return tree(this.projectRoot(projectId).root, this.projectRoot(projectId).root) }
  readFile(projectId: string, relativePath: string): FileDocument {
    const { root } = this.projectRoot(projectId); const path = safePath(root, relativePath, false); const stat = statSync(path)
    if (!stat.isFile()) throw new DomainError('FILE_NOT_FOUND', '目标不是文件。', '选择一个文本文件。')
    if (stat.size > 2_097_152) throw new DomainError('FILE_TOO_LARGE', '文件超过内置编辑器的 2 MiB 限制。', '使用外部编辑器打开。')
    const bytes = readFileSync(path); if (bytes.includes(0)) throw new DomainError('FILE_BINARY_UNSUPPORTED', '二进制文件不能在此编辑。', '使用适合该格式的应用打开。')
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])); const content = bytes.subarray(bom ? 3 : 0).toString('utf8')
    return { projectId, relativePath, content, contentHash: contentHash(bytes), modifiedAt: stat.mtime.toISOString(), encoding: bom ? 'utf8-bom' : 'utf8', eol: content.includes('\r\n') ? 'crlf' : 'lf', readOnly: !editable(relativePath) }
  }
  async writeFile(projectId: string, relativePath: string, content: string, expectedHash: string, createSnapshot = true): Promise<FileDocument> {
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace); const target = safePath(root, relativePath, false)
    const current = readFileSync(target); if (contentHash(current) !== expectedHash) throw new DomainError('FILE_REVISION_CONFLICT', '文件已在外部发生变化。', '比较磁盘版本后再保存。')
    if (createSnapshot) await this.createSnapshot(projectId, `保存前 · ${relativePath}`, 'before-write', [relativePath])
    const temp = join(dirname(target), `.cpppet-${randomUUID()}.tmp`); writeFileSync(temp, content, 'utf8')
    try { renameSync(temp, target) } catch (error) { rmSync(temp, { force: true }); throw error }
    this.event('file.patched', projectId, { relativePath }); return this.readFile(projectId, relativePath)
  }
  createEntry(projectId: string, relativePath: string, kind: 'file' | 'directory'): FileTreeNode {
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace); const path = safePath(root, relativePath)
    if (existsSync(path)) throw new DomainError('FILE_ALREADY_EXISTS', '同名文件或目录已存在。', '使用其他名称。')
    kind === 'directory' ? mkdirSync(path, { recursive: true }) : (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, '', 'utf8'))
    this.event('file.created', projectId, { relativePath, kind }); return { name: basename(path), relativePath, kind, editable: kind === 'file' && editable(path) }
  }
  renameEntry(projectId: string, relativePath: string, nextName: string): void {
    if (!nextName || nextName.includes('/') || nextName.includes('\\') || forbiddenNames.test(nextName)) throw new DomainError('FILE_NAME_INVALID', '文件名无效。', '请修改文件名。')
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace); const from = safePath(root, relativePath, false); const to = safePath(root, join(dirname(relativePath), nextName))
    if (existsSync(to)) throw new DomainError('FILE_ALREADY_EXISTS', '目标名称已存在。', '使用其他名称。')
    renameSync(from, to); this.event('file.renamed', projectId, { relativePath, nextName })
  }
  copyEntry(projectId: string, relativePath: string, destination: string): void {
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace)
    const from = safePath(root, relativePath, false); const to = safePath(root, destination)
    if (existsSync(to)) throw new DomainError('FILE_ALREADY_EXISTS', '目标位置已存在同名内容。', '选择其他目标路径。')
    mkdirSync(dirname(to), { recursive: true }); statSync(from).isDirectory() ? cpSync(from, to, { recursive: true, errorOnExist: true }) : copyFileSync(from, to)
    this.event('file.created', projectId, { relativePath: destination, copiedFrom: relativePath })
  }
  moveEntry(projectId: string, relativePath: string, destination: string): void {
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace)
    const from = safePath(root, relativePath, false); const to = safePath(root, destination)
    if (existsSync(to)) throw new DomainError('FILE_ALREADY_EXISTS', '目标位置已存在同名内容。', '选择其他目标路径。')
    mkdirSync(dirname(to), { recursive: true }); renameSync(from, to); this.event('file.renamed', projectId, { relativePath, destination })
  }
  async removeEntry(projectId: string, relativePath: string): Promise<void> {
    const { root, workspace } = this.projectRoot(projectId); this.requireTrusted(workspace); const target = safePath(root, relativePath, false)
    await this.createSnapshot(projectId, `删除前 · ${relativePath}`, 'before-delete', statSync(target).isDirectory() ? listFiles(target).map(x => relative(root, x)) : [relativePath])
    rmSync(target, { recursive: true, force: false }); this.event('file.deleted', projectId, { relativePath })
  }
  search(projectId: string, query: string): SearchResult[] {
    if (!query.trim()) return []; const { root } = this.projectRoot(projectId); const results: SearchResult[] = []
    for (const path of listFiles(root).slice(0, 5000)) { if (!editable(path) || statSync(path).size > 1_048_576) continue; const lines = readFileSync(path, 'utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length && results.length < 200; i++) { const line = lines[i] ?? ''; const start = line.toLowerCase().indexOf(query.toLowerCase()); if (start >= 0) results.push({ relativePath: relative(root, path), line: i + 1, excerpt: line.trim(), start, end: start + query.length }) }
      if (results.length >= 200) break }
    return results
  }

  async createSnapshot(projectId: string, label: string, reason: SnapshotManifest['reason'] = 'manual', selected?: string[]): Promise<SnapshotManifest> {
    const { root } = this.projectRoot(projectId); const paths = selected?.map(x => safePath(root, x, false)) ?? listFiles(root); const id = randomUUID(); const blobDir = join(this.snapshotRoot, 'blobs'); const manifestDir = join(this.snapshotRoot, 'manifests'); mkdirSync(blobDir, { recursive: true }); mkdirSync(manifestDir, { recursive: true })
    const entries: SnapshotManifest['entries'] = []; const blobHashes: Record<string, string> = {}
    for (const path of paths) { if (!statSync(path).isFile()) continue; const bytes = readFileSync(path); const hash = contentHash(bytes); const blob = join(blobDir, `${hash}.gz`); if (!existsSync(blob)) await pipeline(createReadStream(path), createGzip(), createWriteStream(blob)); const rel = relative(root, path); entries.push({ relativePath: rel, contentHash: hash, size: bytes.length }); blobHashes[rel] = hash }
    const createdAt = new Date().toISOString(); const manifest: SnapshotRecord = { id, projectId, label: label || '未命名快照', reason, scope: selected ? 'files' : 'project', entries, createdAt, manifestPath: join(manifestDir, `${id}.json`), blobHashes }
    writeFileSync(manifest.manifestPath, JSON.stringify(manifest, null, 2)); this.db.saveSnapshot(manifest); this.event('snapshot.created', projectId, { snapshotId: id, entries: entries.length }); return manifest
  }
  listSnapshots(projectId: string): SnapshotManifest[] { return this.db.listSnapshots(projectId).map(({ manifestPath: _, blobHashes: __, ...item }) => item) }
  previewRestore(snapshotId: string): RestorePreview {
    const snapshot = this.requiredSnapshot(snapshotId); const { root } = this.projectRoot(snapshot.projectId); const snap = new Map(snapshot.entries.map(x => [x.relativePath, x.contentHash])); const current = new Map(listFiles(root).map(path => [relative(root, path), contentHash(readFileSync(path))]))
    const added: string[] = [], overwritten: string[] = [], unchanged: string[] = [], deleted: string[] = []
    for (const [path, hash] of snap) !current.has(path) ? added.push(path) : current.get(path) === hash ? unchanged.push(path) : overwritten.push(path)
    if (snapshot.scope === 'project') for (const path of current.keys()) if (!snap.has(path)) deleted.push(path)
    return { snapshotId, added, overwritten, unchanged, deleted }
  }
  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.requiredSnapshot(snapshotId); const { root, workspace } = this.projectRoot(snapshot.projectId); this.requireTrusted(workspace); await this.createSnapshot(snapshot.projectId, '恢复前自动快照', 'before-restore')
    const preview = this.previewRestore(snapshotId); for (const path of preview.deleted) rmSync(safePath(root, path, false), { force: true })
    for (const entry of snapshot.entries) { const target = safePath(root, entry.relativePath); mkdirSync(dirname(target), { recursive: true }); const blob = join(this.snapshotRoot, 'blobs', `${snapshot.blobHashes[entry.relativePath]}.gz`); if (!existsSync(blob)) throw new DomainError('SNAPSHOT_BLOB_MISSING', '快照内容不完整。', '保留当前文件并选择其他快照。'); await pipeline(createReadStream(blob), createGunzip(), createWriteStream(target)) }
    this.event('snapshot.restored', snapshot.projectId, { snapshotId })
  }
  removeSnapshot(snapshotId: string): void {
    const snapshot = this.requiredSnapshot(snapshotId); const blobs = [...new Set(Object.values(snapshot.blobHashes))]; this.db.removeSnapshot(snapshotId)
    rmSync(snapshot.manifestPath, { force: true })
    for (const hash of blobs) if (this.db.blobReferenceCount(hash) === 0) rmSync(join(this.snapshotRoot, 'blobs', `${hash}.gz`), { force: true })
    this.event('snapshot.deleted', snapshot.projectId, { snapshotId })
  }
  async removeProject(projectId: string, deleteFiles: boolean): Promise<void> {
    const { root, workspace } = this.projectRoot(projectId)
    if (deleteFiles) { this.requireTrusted(workspace); await this.createSnapshot(projectId, '删除项目磁盘内容前', 'before-delete'); rmSync(root, { recursive: true, force: false }) }
    this.db.removeProject(projectId); this.event('project.removed', projectId, { deleteFiles })
  }
  private requiredWorkspace(id: string): Workspace { const w = this.db.getWorkspace(id); if (!w) throw new DomainError('WS_NOT_FOUND', '工作区不存在。', '重新选择工作区。'); return w }
  private requiredSnapshot(id: string): SnapshotRecord { const s = this.db.getSnapshot(id); if (!s) throw new DomainError('SNAPSHOT_NOT_FOUND', '快照不存在。', '刷新快照列表。'); return s }
  private requireTrusted(workspace: Workspace): void {
    if (this.db.recoveryMode) throw new DomainError('APP_RECOVERY_MODE', '数据库处于只读恢复模式。', '先检查迁移备份并恢复数据库。')
    if (workspace.trustState !== 'trusted') throw new DomainError('POLICY_WORKSPACE_READ_ONLY', '工作区当前为只读。', '确认目录内容后信任工作区。')
  }
  private event(type: string, projectId: string | undefined, payload: unknown): void { this.db.addEvent({ eventId: randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), actor: 'user', ...(projectId ? { projectId } : {}), payload }) }
}

function projectFiles(type: Project['type'], mode: Project['creationMode'], statement?: string, description?: string, samples: Array<{ input: string; output: string }> = []) {
  const header = mode === 'description' && description ? `# ${description}\n\n` : '# C++ 学习项目\n\n'
  const main = '#include <iostream>\n\nint main() {\n    std::cout << "Hello, C++!" << std::endl;\n    return 0;\n}\n'
  const files = type === 'single-file' ? [{ relativePath: 'main.cpp', content: main }, { relativePath: 'README.md', content: header }]
    : type === 'multi-file' ? [{ relativePath: 'src/main.cpp', content: main }, { relativePath: 'include/utils.hpp', content: '#pragma once\n' }, { relativePath: 'src/utils.cpp', content: '#include "utils.hpp"\n' }, { relativePath: 'README.md', content: header }]
      : [{ relativePath: 'src/main.cpp', content: main }, { relativePath: 'CMakeLists.txt', content: 'cmake_minimum_required(VERSION 3.20)\nproject(CppPetProject LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\nadd_executable(cpp_pet src/main.cpp)\nenable_testing()\nadd_test(NAME cpp_pet_runs COMMAND cpp_pet)\n' }, { relativePath: 'README.md', content: header }]
  if (mode === 'problem') files.push({ relativePath: 'problem.md', content: statement ?? '# 题目\n' }, { relativePath: 'tests/cases.json', content: JSON.stringify(samples, null, 2) })
  return files
}
function tree(root: string, directory: string): FileTreeNode[] { return readdirSync(directory, { withFileTypes: true }).filter(x => !ignored.has(x.name) && !x.name.startsWith('.cpppet-')).map(entry => { const path = join(directory, entry.name); const rel = relative(root, path); const stat = statSync(path); return entry.isDirectory() ? { name: entry.name, relativePath: rel, kind: 'directory' as const, editable: false, modifiedAt: stat.mtime.toISOString(), children: tree(root, path) } : { name: entry.name, relativePath: rel, kind: 'file' as const, editable: editable(entry.name), size: stat.size, modifiedAt: stat.mtime.toISOString() } }) }
function listFiles(root: string): string[] { const out: string[] = []; for (const entry of readdirSync(root, { withFileTypes: true })) { if (ignored.has(entry.name) || entry.name.startsWith('.cpppet-')) continue; const path = join(root, entry.name); entry.isDirectory() ? out.push(...listFiles(path)) : entry.isFile() && out.push(path) } return out }
