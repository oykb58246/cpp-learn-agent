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
    db = new AppDatabase(file, [{ version: 99, name: 'intentional-failure', sql: 'THIS IS NOT SQL' }])
    expect(db.recoveryMode).toBe(true)
    expect(db.listWorkspaces()[0]?.id).toBe(id)
    expect(() => db.updateSettings({ theme: 'dark' })).toThrow('read-only recovery mode')
    expect(existsSync(join(dir, 'backups'))).toBe(true)
    db.close()
  })
  it('persists verified toolchain profiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    let db = new AppDatabase(file)
    const profile = {
      id: crypto.randomUUID(), family: 'gcc' as const, version: '14.2.0', targetArch: 'x64',
      compilerPath: 'C:/mingw/bin/g++.exe', debuggerPath: 'C:/mingw/bin/gdb.exe',
      capabilities: { compile: true, debug: true, compileDatabase: true }, verifiedAt: new Date().toISOString()
    }
    db.saveToolchainProfile(profile); db.setActiveToolchain(profile.id); db.close()
    db = new AppDatabase(file)
    expect(db.listToolchainProfiles()[0]).toEqual(profile)
    expect(db.getSettings().activeToolchainId).toBe(profile.id)
    db.close()
  })
})
