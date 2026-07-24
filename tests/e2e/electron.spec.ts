import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment, findMainApplicationWindow, setWorkspaceAgentOpen } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
let temp = ''
test.beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'cpppet-e2e-')); mkdirSync(join(temp, 'workspace')); mkdirSync(join(repo, 'test-results', 'visual'), { recursive: true }) })
test.afterEach(() => rmSync(temp, { recursive: true, force: true }))

async function captureWindow(electronApp: ElectronApplication, page: Page, path: string) {
  const browserWindow = await electronApp.browserWindow(page)
  const png = await browserWindow.evaluate(async win => (await win.capturePage()).toPNG().toString('base64'))
  writeFileSync(path, Buffer.from(png, 'base64'))
}

test('explains how to resume after skipping first-run setup', async () => {
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({ CPP_PET_USER_DATA: join(temp, 'user-data'), CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace'), CPP_PET_E2E_INSTALLER: 'mock' })
  })
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: '把 C++ 环境准备好' })).toBeVisible()
    const installerStatus = await page.evaluate(() => window.cppPet.environment.installerStatus())
    expect(installerStatus.ok).toBe(true)
    await page.getByRole('button', { name: '稍后配置' }).click()
    await expect(page.getByRole('heading', { name: '暂时跳过环境配置？' })).toBeVisible()
    await expect(page.getByText('左侧活动栏 → 设置 → C++ 工具链 → 环境向导', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '确认稍后配置' }).click()
    await expect(page.getByRole('heading', { name: '让 CppPilot 助教先了解一下你的情况' })).toBeVisible()
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(page.getByRole('heading', { name: '开始处理你的 C++ 问题' })).toBeVisible()
    await expect(page.locator('.environment-reminder')).toContainText('环境初始化尚未完成')
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'onboarding-skipped-home-1440x900.png'))
    const settings = await page.evaluate(() => window.cppPet.settings.get())
    expect(settings.ok && settings.data.onboardingStatus).toBe('skipped')
    await page.getByRole('button', { name: '环境向导', exact: true }).click()
    await expect(page.getByRole('heading', { name: '把 C++ 环境准备好' })).toBeVisible()
    await page.getByRole('button', { name: '开始初始化' }).click()
    await expect(page.getByRole('heading', { name: '检测开发环境' })).toBeVisible()
    await expect(page.locator('.readiness-line')).toContainText('/ 5 项已就绪', { timeout: 30_000 })
    const trackedInstall = await page.evaluate(async () => {
      const completed = new Promise<Parameters<Parameters<typeof window.cppPet.environment.onInstallChanged>[0]>[0]>(resolve => {
        const unlisten = window.cppPet.environment.onInstallChanged(task => {
          if (task.target !== 'llvm' || task.status !== 'succeeded') return
          unlisten()
          resolve(task)
        })
      })
      const started = await window.cppPet.environment.install({ target: 'llvm' })
      if (!started.ok || !started.data.task) return { started, completed: null }
      return { started, completed: await completed }
    })
    expect(trackedInstall.started.ok).toBe(true)
    expect(trackedInstall.completed).toMatchObject({ target: 'llvm', status: 'succeeded', exitCode: 0 })
    const tasks = await page.evaluate(() => window.cppPet.environment.installTasks())
    expect(tasks.ok && tasks.data[0]?.status).toBe('succeeded')
  } finally { await electronApp.close() }
})

test('launches securely and renders the real project workflow', async () => {
  test.setTimeout(180_000)
  // Keep Chromium inside the test process on restricted Windows runners.
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({ CPP_PET_USER_DATA: join(temp, 'user-data'), CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace') })
  })
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const mainState = await electronApp.evaluate(({ app }) => ({ userData: app.getPath('userData'), seedRoot: process.env.CPP_PET_E2E_SEED_ROOT ?? null }))
    expect(mainState.seedRoot).toBe(join(temp, 'workspace'))
    expect(mainState.userData).toBe(join(temp, 'user-data'))
    const bootstrap = await page.evaluate(() => window.cppPet.app.getBootstrap())
    expect(bootstrap.ok).toBe(true)
    if (bootstrap.ok) expect(bootstrap.data.recentProjects.map(item => item.name)).toContain('边界练习')
    await expect(page.getByRole('heading', { name: '把 C++ 环境准备好' })).toBeVisible()
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'onboarding-welcome-1440x900.png'))
    const browserWindow = await electronApp.browserWindow(page)
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'onboarding-welcome-1024x720.png'))
    await browserWindow.evaluate(win => win.setSize(1440, 900))
    const security = await page.evaluate(() => ({ api: typeof window.cppPet, nodeRequire: typeof (window as any).require, process: typeof (window as any).process, genericInvoke: typeof (window.cppPet as any).invoke }))
    expect(security).toEqual({ api: 'object', nodeRequire: 'undefined', process: 'undefined', genericInvoke: 'undefined' })
    await page.getByRole('button', { name: '开始初始化' }).click()
    await expect(page.getByRole('heading', { name: '检测开发环境' })).toBeVisible()
    await expect(page.locator('.readiness-line')).toContainText('/ 5 项已就绪', { timeout: 30_000 })
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'onboarding-detection-1024x720.png'))
    await browserWindow.evaluate(win => win.setSize(1440, 900))
    await page.getByRole('button', { name: '配置工具链' }).click()
    await expect(page.getByRole('heading', { name: '选择 C++ 工具链' })).toBeVisible()
    await page.getByRole('button', { name: '验证并使用' }).click()
    await expect(page.locator('.setup-result')).toContainText('已验证并绑定', { timeout: 30_000 })
    await page.getByRole('button', { name: '下一步' }).click()
    await expect(page.getByRole('heading', { name: '选择代码工作区' })).toBeVisible()
    await expect(page.locator('.workspace-permission')).toContainText('工作区已授权')
    await page.getByRole('button', { name: '完成检查' }).click()
    await expect(page.getByRole('heading', { name: '可以开始写 C++ 了' })).toBeVisible()
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'onboarding-complete-1440x900.png'))
    await page.getByRole('button', { name: '进入首页' }).click()
    await expect(page.getByRole('heading', { name: '让 CppPilot 助教先了解一下你的情况' })).toBeVisible()
    await page.getByRole('button', { name: '开始使用' }).click()
    await expect(page.getByRole('heading', { name: '开始处理你的 C++ 问题' })).toBeVisible()
    await expect(page.getByText('边界练习', { exact: true })).toBeVisible()
    const toolchain = await page.evaluate(async () => {
      const bindings = await window.cppPet.toolchains.list()
      if (!bindings.ok) return bindings
      return {
        ok: true as const,
        data: bindings.data.profiles.find(item => item.id === bindings.data.activeProfileId) ?? null
      }
    })
    expect(toolchain.ok && toolchain.data).toBeTruthy()
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'home-1440x900.png'))
    await page.getByText('边界练习', { exact: true }).click()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-inspector')).toBeVisible()
    const dragSeparator = async (name: string, deltaX: number, deltaY: number) => {
      const separator = page.getByRole('separator', { name })
      const box = await separator.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.mouse.down()
      await page.mouse.move(box!.x + box!.width / 2 + deltaX, box!.y + box!.height / 2 + deltaY, { steps: 6 })
      await page.mouse.up()
    }
    await dragSeparator('调整文件侧边栏宽度', 42, 0)
    await dragSeparator('调整 Agent 侧边栏宽度', -36, 0)
    await dragSeparator('调整底部面板高度', 0, -48)
    const savedLayout = await page.evaluate(async () => {
      const result = await window.cppPet.settings.get()
      return result.ok ? {
        sidebarWidth: result.data.sidebarWidth,
        inspectorWidth: result.data.inspectorWidth,
        bottomPanelHeight: result.data.bottomPanelHeight
      } : null
    })
    expect(savedLayout).toEqual({ sidebarWidth: 302, inspectorWidth: 356, bottomPanelHeight: 238 })
    expect(Math.round(await page.locator('.workspace-sidebar').evaluate(element => element.getBoundingClientRect().width))).toBe(savedLayout!.sidebarWidth)
    expect(Math.round(await page.locator('.workspace-agent-inspector').evaluate(element => element.getBoundingClientRect().width))).toBe(savedLayout!.inspectorWidth)
    expect(Math.round(await page.locator('.bottom-panel').evaluate(element => element.getBoundingClientRect().height))).toBe(savedLayout!.bottomPanelHeight)
    await page.getByText('main.cpp', { exact: true }).click()
    const editor = page.locator('.monaco-editor-host .monaco-editor')
    const snapshotItems = page.locator('.snapshot-list article')
    const snapshotCount = () => page.evaluate(async () => {
      const projectId = window.location.hash.split('/').at(-1)
      if (!projectId) return 0
      const result = await window.cppPet.snapshots.list({ projectId })
      return result.ok ? result.data.length : 0
    })
    const saveCurrentEdit = async (previousSnapshotCount: number) => {
      const saveButton = page.getByRole('button', { name: '保存', exact: true })
      await expect.poll(async () => (await saveButton.isEnabled()) || (await snapshotCount()) > previousSnapshotCount).toBe(true)
      if (await saveButton.isEnabled()) await saveButton.click()
      await expect.poll(snapshotCount).toBeGreaterThan(previousSnapshotCount)
    }
    await expect(editor).toBeVisible()
    const firstSnapshotCount = await snapshotCount()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('#include <iostream>\n\nint main() {\n    std::cout << "Saved by E2E" << std::endl;\n    return 0;\n}\n')
    await saveCurrentEdit(firstSnapshotCount)
    await page.getByRole('button', { name: '快照', exact: true }).click()
    await expect(snapshotItems.first()).toContainText('保存前')
    await page.getByRole('button', { name: '运行', exact: true }).click()
    await expect(page.locator('.process-output')).toContainText('Saved by E2E', { timeout: 30_000 })
    if (toolchain.ok && toolchain.data?.family === 'gcc' && toolchain.data.debuggerPath) {
      const debugSnapshotCount = await snapshotCount()
      await editor.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.insertText('#include <iostream>\nint main() {\n    int value = 41;\n    value++;\n    std::cout << value << std::endl;\n    return 0;\n}\n')
      await saveCurrentEdit(debugSnapshotCount)
      await editor.click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.getByTitle('使用 GDB 调试当前 C++ 文件').click()
      await expect(page.locator('.debug-summary')).toContainText('已暂停', { timeout: 30_000 })
      await expect(page.locator('.debug-table')).toContainText('value')
      await expect(page.locator('.debug-table')).toContainText('41')
      await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'debug-1440x900.png'))
      await page.getByRole('button', { name: '跨过', exact: true }).click()
      await expect(page.locator('.debug-table')).toContainText('42', { timeout: 30_000 })
      await page.getByRole('button', { name: '停止调试', exact: true }).click()
      await expect(page.locator('.debug-summary')).toContainText('已结束')
    }
    const cmakeProject = await page.evaluate(async () => {
      const bootstrap = await window.cppPet.app.getBootstrap()
      if (!bootstrap.ok || !bootstrap.data.workspaces[0]) return null
      const draft = await window.cppPet.project.preview({
        mode: 'manual',
        workspaceId: bootstrap.data.workspaces[0].id,
        name: 'CMake E2E',
        type: 'cmake'
      })
      if (!draft.ok) return null
      const created = await window.cppPet.project.create({ draftId: draft.data.draftId })
      return created.ok ? created.data : null
    })
    expect(cmakeProject).not.toBeNull()
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.workspace-view')).toBeVisible()
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-inspector')).toBeVisible()
    expect(Math.round(await page.locator('.workspace-sidebar').evaluate(element => element.getBoundingClientRect().width))).toBe(savedLayout!.sidebarWidth)
    expect(Math.round(await page.locator('.workspace-agent-inspector').evaluate(element => element.getBoundingClientRect().width))).toBe(savedLayout!.inspectorWidth)
    expect(Math.round(await page.locator('.bottom-panel').evaluate(element => element.getBoundingClientRect().height))).toBe(savedLayout!.bottomPanelHeight)
    await page.locator('.project-picker').click()
    await page.getByRole('option', { name: 'CMake E2E', exact: true }).click()
    await expect(page.locator('.project-picker')).toContainText('CMake E2E')
    const engineeringTools = await page.evaluate(() => window.cppPet.toolchains.detect())
    const toolKinds = engineeringTools.ok ? engineeringTools.data.tools.map(item => item.kind) : []
    await page.getByRole('button', { name: '工程构建', exact: true }).click()
    if (toolKinds.includes('cmake') && toolKinds.includes('ctest')) {
      await expect.poll(async () => {
        const output = await page.locator('.process-output').textContent() ?? ''
        if (output.includes('[CMake 构建] 成功')) return 'success'
        const error = await page.locator('.error-toast').textContent().catch(() => null)
        return error ? `error:${error}` : 'pending'
      }, { timeout: 60_000 }).toBe('success')
      await expect(page.locator('.process-output')).toContainText('compile_commands.json 已生成')
      await page.getByRole('button', { name: '测试', exact: true }).click()
      await expect(page.locator('.process-output')).toContainText('[CTest] 通过 · 1/1 通过', { timeout: 30_000 })
    } else {
      await expect(page.locator('.error-toast')).toContainText('未找到 CMake')
      await page.locator('.error-toast').getByRole('button', { name: '关闭' }).click()
    }
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'workspace-1440x900.png'))
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    await expect(page.locator('.workspace-view')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'workspace-1024x720.png'))
    await browserWindow.evaluate(win => win.setSize(1440, 900))
    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.locator('.activity-rail').getByRole('link', { name: '工作区' }).click()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'workspace-dark-1440x900.png'))
    await page.locator('.activity-rail').getByRole('link', { name: '首页' }).click()
    await expect(page.getByRole('heading', { name: '开始处理你的 C++ 问题' })).toBeVisible()
    await captureWindow(electronApp, page, join(repo, 'test-results', 'visual', 'home-dark-1440x900.png'))
  } finally { await electronApp.close() }
})
