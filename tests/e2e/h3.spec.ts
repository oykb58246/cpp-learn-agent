import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment, findMainApplicationWindow, setWorkspaceAgentOpen, startStreamingModelFixture } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
let temp = ''

test.beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'cpppilot-h3-e2e-'))
  mkdirSync(join(temp, 'workspace'))
  mkdirSync(join(repo, 'test-results', 'visual'), { recursive: true })
})
test.afterEach(() => rmSync(temp, { recursive: true, force: true }))

async function captureWindow(electronApp: ElectronApplication, page: Page, name: string) {
  const browserWindow = await electronApp.browserWindow(page)
  const png = await browserWindow.evaluate(async win => (await win.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(repo, 'test-results', 'visual', name), Buffer.from(png, 'base64'))
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const overflowingContainers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.app-content, .page-scroll, .h3-view'))
    .filter(element => element.scrollWidth > element.clientWidth + 1)
    .map(element => ({
      className: element.className,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    })))
  expect(overflowingContainers).toEqual([])
}

async function setWindowSize(electronApp: ElectronApplication, page: Page, width: number, height: number) {
  const browserWindow = await electronApp.browserWindow(page)
  await browserWindow.evaluate((win, size) => win.setSize(size.width, size.height), { width, height })
  await expect.poll(async () => {
    const [actualWidth, actualHeight] = await browserWindow.evaluate(win => win.getSize())
    return Math.abs(actualWidth - width) <= 2 && Math.abs(actualHeight - height) <= 2
  }).toBe(true)
}

test('completes the verified H3 diagnose and learning workflow', async () => {
  test.setTimeout(180_000)
  const modelFixture = await startStreamingModelFixture()
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({ CPP_PET_USER_DATA: join(temp, 'user-data'), CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace') })
  })
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const setup = await page.evaluate(async baseUrl => {
      await window.cppPet.settings.update({ onboardingStatus: 'completed' })
      const detected = await window.cppPet.toolchains.detect()
      if (!detected.ok || !detected.data.candidates[0]) return { error: 'NO_TOOLCHAIN' }
      const candidate = detected.data.candidates.find(item => item.family === 'gcc') ?? detected.data.candidates[0]
      const bound = await window.cppPet.toolchains.bind({ candidateId: candidate.id })
      if (!bound.ok) return { error: bound.error.code }
      const bootstrap = await window.cppPet.app.getBootstrap()
      if (!bootstrap.ok || !bootstrap.data.recentProjects[0]) return { error: 'NO_PROJECT' }
      const project = bootstrap.data.recentProjects[0]
      const document = await window.cppPet.files.read({ projectId: project.id, relativePath: 'main.cpp' })
      if (!document.ok) return { error: document.error.code }
      const written = await window.cppPet.files.write({
        projectId: project.id,
        relativePath: 'main.cpp',
        expectedHash: document.data.contentHash,
        content: '#include <iostream>\n\nint main() {\n    std::cout << "missing semicolon"\n    return 0;\n}\n',
        createSnapshot: false
      })
      if (!written.ok) return { error: written.error.code }
      for (const conceptId of ['basics.program', 'basics.variables', 'basics.types', 'functions.basic']) {
        const knowledge = await window.cppPet.learning.updateKnowledge({ conceptId, status: 'learning' })
        if (!knowledge.ok) return { error: knowledge.error.code }
      }
      const model = await window.cppPet.model.save({
        name: 'H3 Responses model', baseUrl, model: 'gpt-5', enabled: true, timeoutMs: 10_000, apiKey: 'fixture-key'
      })
      return model.ok ? { projectId: project.id } : { error: model.error.code }
    }, modelFixture.baseUrl)
    expect(setup).toHaveProperty('projectId')
    const projectId = (setup as { projectId: string }).projectId
    await setWindowSize(electronApp, page, 1440, 900)
    await page.evaluate(id => { window.location.hash = `#/workspace/${id}` }, projectId)
    await page.reload()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await page.getByText('main.cpp', { exact: true }).click()
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-panel')).toBeVisible()
    await expect(page.getByLabel('Agent 模式')).toHaveCount(0)
    await page.getByPlaceholder('随心输入').fill('修复当前编译错误并解释根因')
    await page.locator('.workspace-agent-panel .agent-composer button[type="submit"]').click()
    await expect(page.locator('.approval-card')).toContainText('发送上下文到 OpenAI 模型', { timeout: 30_000 })
    await page.getByRole('button', { name: '批准', exact: true }).click()
    await expect(page.locator('.approval-card')).toContainText('应用文件修改', { timeout: 30_000 })
    await expect(page.locator('.conversation-transcript')).toHaveCount(0)
    await expect(page.locator('.conversation-approval-view')).toBeVisible()
    await expect(page.locator('.approval-diff')).toContainText('--- a/main.cpp')
    await expect(page.locator('.approval-diff')).toContainText('+    std::cout << "missing semicolon";')
    await page.getByRole('button', { name: '批准', exact: true }).click()
    await expect(page.locator('.workspace-agent-panel')).toContainText('completed', { timeout: 30_000 })
    await captureWindow(electronApp, page, 'h3-workspace-agent-1440x900.png')

    await setWindowSize(electronApp, page, 1024, 720)
    await expectNoHorizontalOverflow(page)
    await expect(page.locator('.workspace-agent-evidence')).toHaveCount(0)
    await captureWindow(electronApp, page, 'h3-workspace-agent-1024x720.png')
    await setWindowSize(electronApp, page, 1440, 900)

    await page.getByRole('link', { name: '助教记录' }).click()
    await expect(page.getByRole('heading', { name: '助教记录' })).toBeVisible()
    await expect(page.locator('.run-timeline')).toContainText('workspace.apply_patch')
    await expect(page.locator('.run-timeline')).toContainText('compiler.build')
    await captureWindow(electronApp, page, 'h3-runs-1440x900.png')

    await page.getByRole('link', { name: '知识树' }).click()
    await expect(page.getByRole('heading', { name: '知识树' })).toBeVisible()
    await expect(page.locator('.knowledge-board')).toBeVisible()
    await expect(page.locator('.knowledge-stage')).toHaveCount(17)
    await expect(page.getByRole('button', { name: '编辑背景' })).toHaveCount(0)
    await expect(page.getByText('待复习', { exact: true })).toHaveCount(0)

    const blockedArrays = page.locator('[data-concept-id="data.arrays"]')
    await expect(blockedArrays).toHaveClass(/blocked/)
    await expect(blockedArrays.getByRole('button', { name: /数组 切换掌握状态，当前未学习/ })).toBeEnabled()
    await expect(blockedArrays.locator('.knowledge-prerequisites')).toContainText('循环')

    const ioCard = page.locator('[data-concept-id="basics.io"]')
    await ioCard.getByRole('button', { name: /标准输入输出 切换掌握状态，当前未学习/ }).click()
    await expect(ioCard.getByRole('button', { name: /标准输入输出 切换掌握状态，当前学习中/ })).toBeVisible()
    await ioCard.getByRole('button', { name: /标准输入输出 切换掌握状态，当前学习中/ }).click()
    await expect(ioCard).toContainText('已掌握')
    await captureWindow(electronApp, page, 'h3-knowledge-path-1440x900.png')
    await setWindowSize(electronApp, page, 1024, 720)
    await expectNoHorizontalOverflow(page)
    await captureWindow(electronApp, page, 'h3-knowledge-path-1024x720.png')
    await setWindowSize(electronApp, page, 1440, 900)

    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /模型服务 BYOK 与离线/ }).click()
    await expect(page).toHaveURL(/#\/settings\?section=models$/)
    await expect(page.getByRole('heading', { name: '模型服务' })).toBeVisible()
    await expect(page.locator('.model-mode-line')).toContainText('OpenAI Responses API 可用')
    await setWindowSize(electronApp, page, 1024, 720)
    await expect(page.locator('.settings-module-nav')).toBeVisible()
    await expect(page.locator('.settings-section:visible')).toHaveCount(1)
    await expect(page.locator('#models')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await captureWindow(electronApp, page, 'h3-settings-1024x720.png')
  } finally {
    await electronApp.close()
    await modelFixture.close()
  }
})
