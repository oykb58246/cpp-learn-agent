import { test, expect, _electron as electron } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
let temp = ''
test.beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'cpppet-e2e-')); mkdirSync(join(temp, 'workspace')); mkdirSync(join(repo, 'test-results', 'visual'), { recursive: true }) })
test.afterEach(() => rmSync(temp, { recursive: true, force: true }))

test('launches securely and renders the real project workflow', async () => {
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(repo, 'apps/desktop')],
    env: { ...process.env, CPP_PET_USER_DATA: join(temp, 'user-data'), CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace') }
  })
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const mainState = await electronApp.evaluate(({ app }) => ({ userData: app.getPath('userData'), seedRoot: process.env.CPP_PET_E2E_SEED_ROOT ?? null }))
    expect(mainState.seedRoot).toBe(join(temp, 'workspace'))
    expect(mainState.userData).toBe(join(temp, 'user-data'))
    const bootstrap = await page.evaluate(() => window.cppPet.app.getBootstrap())
    expect(bootstrap.ok).toBe(true)
    if (bootstrap.ok) expect(bootstrap.data.recentProjects.map(item => item.name)).toContain('边界练习')
    await expect(page.getByRole('heading', { name: '继续你的 C++ 学习' })).toBeVisible()
    await expect(page.getByText('边界练习', { exact: true })).toBeVisible()
    const security = await page.evaluate(() => ({ api: typeof window.cppPet, nodeRequire: typeof (window as any).require, process: typeof (window as any).process, genericInvoke: typeof (window.cppPet as any).invoke }))
    expect(security).toEqual({ api: 'object', nodeRequire: 'undefined', process: 'undefined', genericInvoke: 'undefined' })
    await page.screenshot({ path: join(repo, 'test-results', 'visual', 'home-1440x900.png') })
    await page.getByText('边界练习', { exact: true }).click()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await page.getByText('main.cpp', { exact: true }).click()
    const editor = page.locator('.basic-editor')
    await expect(editor).toHaveValue(/Hello, C\+\+!/)
    await editor.fill('#include <iostream>\n\nint main() {\n    std::cout << "Saved by E2E" << std::endl;\n    return 0;\n}\n')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.snapshot-list article').first()).toContainText('保存前')
    await page.screenshot({ path: join(repo, 'test-results', 'visual', 'workspace-1440x900.png') })
    const browserWindow = await electronApp.browserWindow(page)
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    await expect(page.locator('.workspace-view')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: join(repo, 'test-results', 'visual', 'workspace-1024x720.png') })
    await browserWindow.evaluate(win => win.setSize(1440, 900))
    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.locator('.activity-rail').getByRole('link', { name: '工作区' }).click()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await page.screenshot({ path: join(repo, 'test-results', 'visual', 'workspace-dark-1440x900.png') })
    await page.locator('.activity-rail').getByRole('link', { name: '首页' }).click()
    await expect(page.getByRole('heading', { name: '继续你的 C++ 学习' })).toBeVisible()
    await page.screenshot({ path: join(repo, 'test-results', 'visual', 'home-dark-1440x900.png') })
  } finally { await electronApp.close() }
})
