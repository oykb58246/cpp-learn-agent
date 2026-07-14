import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from './index'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
describe('AppDatabase', () => {
  it('persists settings and workspaces across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    const id = crypto.randomUUID(); let db = new AppDatabase(file)
    db.updateSettings({ theme: 'dark' }); db.upsertWorkspace({ id, name: 'Lab', rootPath: dir, trustState: 'inspection', createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() }); db.close()
    db = new AppDatabase(file); expect(db.getSettings().theme).toBe('dark'); expect(db.listWorkspaces()[0]?.id).toBe(id); db.close()
  })
  it('keeps the previous schema readable when a later migration fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'data', 'app.sqlite')
    const id = crypto.randomUUID(); let db = new AppDatabase(file)
    db.upsertWorkspace({ id, name: 'Safe', rootPath: dir, trustState: 'trusted', createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() }); db.close()
    db = new AppDatabase(file, [{ version: 2, name: 'intentional-failure', sql: 'THIS IS NOT SQL' }])
    expect(db.recoveryMode).toBe(true)
    expect(db.listWorkspaces()[0]?.id).toBe(id)
    expect(() => db.updateSettings({ theme: 'dark' })).toThrow('read-only recovery mode')
    expect(existsSync(join(dir, 'backups'))).toBe(true)
    db.close()
  })
})
