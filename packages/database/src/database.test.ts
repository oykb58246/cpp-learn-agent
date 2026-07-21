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
    expect(db.getSettings()).toMatchObject({
      onboardingCompleted: false, onboardingStatus: 'pending', onboardingReminderDismissed: false, cursorStyle: 'mascot',
      pet: { visible: true, assetMode: 'cpppilot-logo', scale: 1, ignoreMouseEvents: false, bubbleEnabled: true, focusModeEnabled: false, launchAtLogin: false, customAssets: [] }
    })
    db.updateSettings({ onboardingCompleted: true, onboardingStatus: 'skipped', onboardingReminderDismissed: false }); db.close()
    db = new AppDatabase(file)
    expect(db.getSettings()).toMatchObject({ onboardingCompleted: true, onboardingStatus: 'skipped', onboardingReminderDismissed: false })
    db.close()
  })
  it('persists user-imported practice exercises across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    const now = new Date().toISOString()
    const exercise = {
      id: crypto.randomUUID(), title: 'A+B Problem', knowledgePoint: '输入输出', conceptIds: ['basics.io'], difficulty: 1,
      statement: '输入两个整数 a 和 b，输出它们的和。', constraints: ['-1000 <= a,b <= 1000'],
      samples: [{ input: '1 2', output: '3' }], judgeCases: [
        { id: 'case-1', input: '1 2', expectedOutput: '3', score: 20 as const, visibility: 'sample' as const },
        { id: 'case-2', input: '0 0', expectedOutput: '0', score: 20 as const, visibility: 'hidden' as const },
        { id: 'case-3', input: '-5 7', expectedOutput: '2', score: 20 as const, visibility: 'hidden' as const },
        { id: 'case-4', input: '1000 -1000', expectedOutput: '0', score: 20 as const, visibility: 'hidden' as const },
        { id: 'case-5', input: '-999 -1', expectedOutput: '-1000', score: 20 as const, visibility: 'hidden' as const }
      ], starterCode: '#include <iostream>\nint main(){}', source: 'user' as const,
      createdAt: now, updatedAt: now
    }
    let db = new AppDatabase(file)
    db.savePracticeExercise(exercise)
    expect(db.listPracticeExercises()[0]).toMatchObject({ title: 'A+B Problem', knowledgePoint: '输入输出', source: 'user' })
    db.close()

    db = new AppDatabase(file)
    expect(db.listPracticeExercises()).toHaveLength(1)
    expect(db.listPracticeExercises()[0]?.samples).toEqual([{ input: '1 2', output: '3' }])
    db.close()
  })
  it('persists judge cases and OJ submissions across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    const now = new Date().toISOString()
    const judgeCases = Array.from({ length: 5 }, (_, index) => ({
      id: `case-${index + 1}`,
      input: `${index} ${index + 1}`,
      expectedOutput: `${index * 2 + 1}`,
      score: 20 as const,
      visibility: index === 0 ? 'sample' as const : 'hidden' as const,
      reason: index === 4 ? '边界：较大的普通输入' : '基础覆盖'
    }))
    const exercise = {
      id: crypto.randomUUID(), title: 'A+B Five Cases', knowledgePoint: '输入输出', conceptIds: ['basics.io'], difficulty: 1,
      statement: '输入两个整数 a 和 b，输出它们的和。', constraints: ['-1000 <= a,b <= 1000'],
      samples: [{ input: '1 2', output: '3' }], judgeCases, source: 'user' as const,
      createdAt: now, updatedAt: now
    }
    const submission = {
      submissionId: crypto.randomUUID(), exerciseId: exercise.id, userId: 'local-user', status: 'accepted' as const,
      score: 100, totalScore: 100 as const, passed: true, submittedAt: now,
      compile: {
        success: true,
        diagnostics: [],
        process: { command: 'g++', args: [], exitCode: 0, stdout: '', stderr: '', durationMs: 12, timedOut: false, cancelled: false, outputTruncated: false }
      },
      cases: judgeCases.map(item => ({
        caseId: item.id, visibility: item.visibility, input: item.input, expectedOutput: item.expectedOutput,
        actualOutput: item.expectedOutput, stderr: '', passed: true, score: 20, durationMs: 3, exitCode: 0, timedOut: false
      }))
    }

    let db = new AppDatabase(file)
    db.savePracticeExercise(exercise)
    db.savePracticeSubmission(submission)
    db.close()

    db = new AppDatabase(file)
    expect(db.listPracticeExercises()[0]?.judgeCases).toEqual(judgeCases)
    expect(db.listPracticeSubmissions('local-user', exercise.id)).toEqual([submission])
    db.close()
  })
  it('starts a new user with a pending product tour', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir)
    const db = new AppDatabase(join(dir, 'app.sqlite'))

    expect(db.getSettings()).toMatchObject({
      productTourStatus: 'pending',
      productTourStep: 0,
      productTourWelcomeSeen: false
    })
    db.close()
  })
  it('migrates old settings and persists product tour progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-')); dirs.push(dir); const file = join(dir, 'app.sqlite')
    let db = new AppDatabase(file)
    db.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify({
      theme: 'system', sidebarWidth: 260, inspectorWidth: 320, bottomPanelHeight: 190,
      cursorStyle: 'mascot', onboardingCompleted: true, onboardingStatus: 'completed',
      onboardingReminderDismissed: false
    }))
    expect(db.getSettings()).toMatchObject({ productTourStatus: 'pending', productTourStep: 0, productTourWelcomeSeen: false })

    db.updateSettings({ productTourStatus: 'in-progress', productTourStep: 3, productTourWelcomeSeen: true })
    db.close()
    db = new AppDatabase(file)
    expect(db.getSettings()).toMatchObject({ productTourStatus: 'in-progress', productTourStep: 3, productTourWelcomeSeen: true })
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
