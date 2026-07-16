import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AppDatabase } from './index'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
describe('AppDatabase', () => {
  it('starts onboarding for new users and persists a skipped reminder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    let db = new AppDatabase(file)
    expect(db.getSettings()).toMatchObject({ onboardingCompleted: false, onboardingStatus: 'pending', onboardingReminderDismissed: false, cursorStyle: 'mascot' })
    db.updateSettings({ onboardingCompleted: true, onboardingStatus: 'skipped', onboardingReminderDismissed: false }); db.close()
    db = new AppDatabase(file)
    expect(db.getSettings()).toMatchObject({ onboardingCompleted: true, onboardingStatus: 'skipped', onboardingReminderDismissed: false })
    db.close()
  })
  it('persists settings and workspaces across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    const id = crypto.randomUUID(); let db = new AppDatabase(file)
    db.updateSettings({ theme: 'dark', sidebarWidth: 304, inspectorWidth: 348, bottomPanelHeight: 236, cursorStyle: 'classic', onboardingCompleted: true }); db.upsertWorkspace({ id, name: 'Lab', rootPath: dir, trustState: 'inspection', createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() }); db.close()
    db = new AppDatabase(file); expect(db.getSettings()).toMatchObject({ theme: 'dark', sidebarWidth: 304, inspectorWidth: 348, bottomPanelHeight: 236, cursorStyle: 'classic', onboardingCompleted: true }); expect(db.listWorkspaces()[0]?.id).toBe(id); db.close()
  })
  it('migrates legacy customCursor boolean into cursorStyle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    let db = new AppDatabase(file)
    db.updateSettings({ onboardingCompleted: true, onboardingStatus: 'completed' })
    db.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify({
      theme: 'system', sidebarWidth: 260, inspectorWidth: 320, bottomPanelHeight: 190,
      customCursor: false, onboardingCompleted: true, onboardingStatus: 'completed', onboardingReminderDismissed: false
    }))
    expect(db.getSettings().cursorStyle).toBe('system')
    db.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify({
      theme: 'system', sidebarWidth: 260, inspectorWidth: 320, bottomPanelHeight: 190,
      customCursor: true, onboardingCompleted: true, onboardingStatus: 'completed', onboardingReminderDismissed: false
    }))
    expect(db.getSettings().cursorStyle).toBe('mascot')
    db.close()
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
  it('frees relative_root after soft-deleting a project so the same name can be recreated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    const db = new AppDatabase(file)
    const workspaceId = crypto.randomUUID()
    const now = new Date().toISOString()
    db.upsertWorkspace({ id: workspaceId, name: 'Lab', rootPath: dir, trustState: 'trusted', createdAt: now, lastOpenedAt: now })
    const projectId = crypto.randomUUID()
    db.saveProject({
      id: projectId,
      workspaceId,
      name: 'hello',
      type: 'single-file',
      creationMode: 'manual',
      relativeRoot: 'hello',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    })
    db.removeProject(projectId)
    expect(db.listProjects()).toHaveLength(0)
    const recreated = db.saveProject({
      id: crypto.randomUUID(),
      workspaceId,
      name: 'hello',
      type: 'single-file',
      creationMode: 'manual',
      relativeRoot: 'hello',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now
    })
    expect(recreated.relativeRoot).toBe('hello')
    expect(db.listProjects()).toHaveLength(1)
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
