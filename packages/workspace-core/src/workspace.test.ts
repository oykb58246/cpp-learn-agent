import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from '@cpp-pet/database'
import { DomainError, safePath, WorkspaceService } from './index'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const setup = () => { const dir = mkdtempSync(join(tmpdir(), 'cpppet-core-')); dirs.push(dir); const root = join(dir, 'root'); mkdirSync(root); const db = new AppDatabase(join(dir, 'app.sqlite')); return { dir, root, db, service: new WorkspaceService(db, join(dir, 'snapshots')) } }
describe('safePath', () => {
  it('rejects traversal, absolute paths and Windows device names', () => {
    const { root, db } = setup()
    expect(() => safePath(root, '../secret')).toThrow(DomainError)
    expect(() => safePath(root, join(root, 'x'))).toThrow(DomainError)
    expect(() => safePath(root, 'CON.txt')).toThrow(DomainError)
    expect(() => safePath(root, 'nested/../../secret')).toThrow(DomainError)
    db.close()
  })
  it('rejects a junction that escapes the authorized root', () => {
    const { dir, root, db } = setup(); const outside = join(dir, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(root, 'escape'), 'junction')
    expect(() => safePath(root, 'escape/secret.cpp')).toThrow(DomainError)
    db.close()
  })
})
describe('WorkspaceService', () => {
  it('creates, writes, snapshots and restores a project', async () => {
    const { root, db, service } = setup(); const ws = service.registerWorkspace(root); service.setTrust(ws.id, true)
    const draft = service.previewProject({ mode: 'manual', workspaceId: ws.id, name: 'hello', type: 'single-file' }); const project = service.commitDraft(draft.draftId)
    const doc = service.readFile(project.id, 'main.cpp'); await service.writeFile(project.id, 'main.cpp', 'changed\n', doc.contentHash); const snapshot = await service.createSnapshot(project.id, 'known')
    const changed = service.readFile(project.id, 'main.cpp'); await service.writeFile(project.id, 'main.cpp', 'again\n', changed.contentHash, false); await service.restoreSnapshot(snapshot.id)
    expect(readFileSync(join(root, 'hello', 'main.cpp'), 'utf8')).toBe('changed\n'); db.close()
  })
  it('creates all planned project structures and imports without rewriting source files', () => {
    const { root, db, service } = setup(); const ws = service.registerWorkspace(root); service.setTrust(ws.id, true)
    const modes = [
      { name: 'single', mode: 'manual' as const, type: 'single-file' as const },
      { name: 'multi', mode: 'description' as const, type: 'multi-file' as const, description: '学生成绩管理' },
      { name: 'problem', mode: 'problem' as const, type: 'cmake' as const, statement: '计算两个整数之和' }
    ]
    for (const item of modes) service.commitDraft(service.previewProject({ workspaceId: ws.id, ...item }).draftId)
    expect(existsSync(join(root, 'single', 'main.cpp'))).toBe(true)
    expect(existsSync(join(root, 'multi', 'include', 'utils.hpp'))).toBe(true)
    expect(existsSync(join(root, 'problem', 'CMakeLists.txt'))).toBe(true)
    expect(existsSync(join(root, 'problem', 'tests', 'cases.json'))).toBe(true)
    const imported = join(root, 'existing'); mkdirSync(imported); writeFileSync(join(imported, 'CMakeLists.txt'), 'original', 'utf8')
    const draft = service.previewImport(imported); const project = service.commitDraft(draft.draftId)
    expect(project.creationMode).toBe('import'); expect(readFileSync(join(imported, 'CMakeLists.txt'), 'utf8')).toBe('original')
    db.close()
  })
  it('blocks stale writes and untrusted workspace changes', async () => {
    const { root, db, service } = setup(); const ws = service.registerWorkspace(root); service.setTrust(ws.id, true)
    const project = service.commitDraft(service.previewProject({ mode: 'manual', workspaceId: ws.id, name: 'conflict', type: 'single-file' }).draftId)
    const document = service.readFile(project.id, 'main.cpp'); writeFileSync(join(root, 'conflict', 'main.cpp'), 'external\n', 'utf8')
    await expect(service.writeFile(project.id, 'main.cpp', 'mine\n', document.contentHash)).rejects.toMatchObject({ code: 'FILE_REVISION_CONFLICT' })
    service.setTrust(ws.id, false)
    expect(() => service.createEntry(project.id, 'blocked.cpp', 'file')).toThrowError(/只读/)
    db.close()
  })
  it('supports copy, move, search and delete with a recovery snapshot', async () => {
    const { root, db, service } = setup(); const ws = service.registerWorkspace(root); service.setTrust(ws.id, true)
    const project = service.commitDraft(service.previewProject({ mode: 'manual', workspaceId: ws.id, name: 'files', type: 'single-file' }).draftId)
    service.copyEntry(project.id, 'main.cpp', 'copy.cpp'); service.moveEntry(project.id, 'copy.cpp', 'src/moved.cpp')
    expect(service.search(project.id, 'Hello')[0]?.relativePath).toBe('main.cpp')
    await service.removeEntry(project.id, 'src/moved.cpp')
    expect(existsSync(join(root, 'files', 'src', 'moved.cpp'))).toBe(false)
    expect(service.listSnapshots(project.id).some(item => item.reason === 'before-delete')).toBe(true)
    db.close()
  })
})
