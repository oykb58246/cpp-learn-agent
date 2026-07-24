import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment, findMainApplicationWindow, startStreamingModelFixture, type StreamingModelFixture } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
let temp = ''
let modelFixture: StreamingModelFixture

test.beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), 'cpppilot-tour-e2e-'))
  mkdirSync(join(temp, 'workspace'))
  mkdirSync(join(repo, 'test-results', 'visual'), { recursive: true })
  modelFixture = await startStreamingModelFixture()
})
test.afterEach(async () => {
  await modelFixture.close()
  rmSync(temp, { recursive: true, force: true })
})

async function setWindowSize(electronApp: ElectronApplication, page: Page, width: number, height: number) {
  const browserWindow = await electronApp.browserWindow(page)
  await browserWindow.evaluate((win, size) => win.setSize(size.width, size.height), { width, height })
  await expect.poll(async () => {
    const [actualWidth, actualHeight] = await browserWindow.evaluate(win => win.getSize())
    return Math.abs(actualWidth - width) <= 2 && Math.abs(actualHeight - height) <= 2
  }).toBe(true)
}

async function captureWindow(electronApp: ElectronApplication, page: Page, name: string) {
  const browserWindow = await electronApp.browserWindow(page)
  const png = await browserWindow.evaluate(async win => (await win.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(repo, 'test-results', 'visual', name), Buffer.from(png, 'base64'))
}

async function expectTourInsideViewport(page: Page) {
  const rect = await page.locator('.product-tour-panel').evaluate(element => {
    const value = element.getBoundingClientRect()
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: innerWidth, height: innerHeight }
  })
  expect(rect.left).toBeGreaterThanOrEqual(0)
  expect(rect.top).toBeGreaterThanOrEqual(0)
  expect(rect.right).toBeLessThanOrEqual(rect.width)
  expect(rect.bottom).toBeLessThanOrEqual(rect.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function expectTourNotToOverlapTarget(page: Page, target: string) {
  const overlaps = await page.evaluate(selector => {
    const panel = document.querySelector<HTMLElement>('.product-tour-panel')?.getBoundingClientRect()
    const focus = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`)?.getBoundingClientRect()
    if (!panel || !focus) return true
    return panel.left < focus.right && panel.right > focus.left && panel.top < focus.bottom && panel.bottom > focus.top
  }, target)
  expect(overlaps).toBe(false)
}

test('guides a beginner through a real Responses Agent experience', async () => {
  test.setTimeout(180_000)
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({
      CPP_PET_USER_DATA: join(temp, 'user-data'),
      CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace')
    })
  })
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await page.evaluate(async baseUrl => {
      const settings = await window.cppPet.settings.update({
        onboardingCompleted: true,
        onboardingStatus: 'completed',
        productTourStatus: 'pending',
        productTourStep: 0,
        productTourWelcomeSeen: false
      })
      const background = await window.cppPet.learning.saveBackground({
        onboardingCompleted: true,
        startingPoint: 'zero-beginner',
        studiedConceptIds: [],
        focusConceptIds: []
      })
      const model = await window.cppPet.model.save({
        name: 'Tour Responses model', baseUrl, model: 'gpt-5', enabled: true, timeoutMs: 10_000, apiKey: 'fixture-key'
      })
      return { settings: settings.ok, background: background.ok, model: model.ok }
    }, modelFixture.baseUrl)
    expect(prepared).toEqual({ settings: true, background: true, model: true })
    await page.evaluate(() => { window.location.hash = '#/home' })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await setWindowSize(electronApp, page, 1440, 900)
    await expect(page.getByRole('heading', { name: '五分钟上手 CppPilot' })).toBeVisible()
    await captureWindow(electronApp, page, 'beginner-tour-home-1440x900.png')
    await page.getByRole('button', { name: '开始新手体验' }).click()
    await expect(page.getByRole('dialog', { name: '五分钟认识 CppPilot' })).toBeVisible()
    await expectTourInsideViewport(page)

    await page.getByRole('button', { name: '下一步' }).click()
    await expect.poll(async () => {
      const settings = await page.evaluate(() => window.cppPet.settings.get())
      return settings.ok ? settings.data.productTourStep : -1
    }).toBe(1)
    await expect(page.getByRole('dialog', { name: '四个主要区域' })).toBeVisible()
    await page.getByRole('button', { name: '去问助教' }).click()
    await expect(page).toHaveURL(/#\/runs$/)
    await expect(page.getByRole('dialog', { name: '向助教提出第一个问题' })).toBeVisible()

    await page.getByRole('button', { name: '稍后继续' }).click()
    await expect(page.locator('.product-tour-panel')).toHaveCount(0)
    await page.getByRole('link', { name: '首页' }).click()
    await expect(page.getByRole('button', { name: '继续新手体验' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '继续新手体验' })).toBeVisible()
    await page.getByRole('button', { name: '继续新手体验' }).click()
    await expect(page).toHaveURL(/#\/runs$/)

    await setWindowSize(electronApp, page, 1024, 720)
    await page.getByRole('button', { name: '试着解释这段循环' }).click()
    await expect(page.getByLabel('Agent 模式')).toHaveCount(0)
    await expect(page.getByPlaceholder('随心输入')).toHaveValue(/for \(int i = 0; i < 3; \+\+i\)/)
    await captureWindow(electronApp, page, 'beginner-tour-agent-input-1024x720.png')
    await expectTourInsideViewport(page)
    await page.locator('.runs-composer .agent-composer button[type="submit"]').click()
    await expect(page.locator('.approval-card')).toContainText('发送上下文到 OpenAI 模型', { timeout: 30_000 })
    await page.getByRole('button', { name: '批准', exact: true }).click()
    await expect(page.locator('[data-tour="assistant-result"]')).toContainText('循环', { timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: '看懂助教结果' })).toBeVisible()
    await captureWindow(electronApp, page, 'beginner-tour-agent-result-1024x720.png')
    await expectTourInsideViewport(page)
    await expectTourNotToOverlapTarget(page, 'assistant-result')

    await page.getByRole('button', { name: '下一步：代码工作区' }).click()
    await expect(page).toHaveURL(/#\/workspace/)
    await expect(page.getByRole('dialog', { name: '在代码旁继续提问' })).toBeVisible()
    await setWindowSize(electronApp, page, 1440, 900)
    await captureWindow(electronApp, page, 'beginner-tour-workspace-1440x900.png')
    await page.getByRole('button', { name: '完成体验' }).click()
    await expect(page.getByRole('dialog', { name: '已经可以开始了' })).toBeVisible()
    await page.getByRole('button', { name: '返回首页' }).click()

    await expect(page).toHaveURL(/#\/home$/)
    await expect(page.getByRole('heading', { name: '五分钟上手 CppPilot' })).toHaveCount(0)
    const completed = await page.evaluate(() => window.cppPet.settings.get())
    expect(completed.ok && completed.data.productTourStatus).toBe('completed')

    await page.getByRole('button', { name: '新手帮助' }).click()
    await expect(page.getByRole('dialog', { name: '五分钟认识 CppPilot' })).toBeVisible()
    await page.getByRole('button', { name: '稍后继续' }).click()
    const replayed = await page.evaluate(() => window.cppPet.settings.get())
    expect(replayed.ok && replayed.data.productTourStatus).toBe('completed')
  } finally {
    await electronApp.close()
  }
})

test('keeps the approval card interactive during the assistant tour step', async () => {
  test.setTimeout(90_000)
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({
      CPP_PET_USER_DATA: join(temp, 'approval-user-data'),
      CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace')
    })
  })
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await page.evaluate(async baseUrl => {
      const settings = await window.cppPet.settings.update({
        onboardingCompleted: true,
        onboardingStatus: 'completed',
        productTourStatus: 'pending',
        productTourStep: 0,
        productTourWelcomeSeen: true
      })
      const background = await window.cppPet.learning.saveBackground({
        onboardingCompleted: true,
        startingPoint: 'zero-beginner',
        studiedConceptIds: [],
        focusConceptIds: []
      })
      const model = await window.cppPet.model.save({
        name: 'Approval test model',
        baseUrl,
        model: 'gpt-5',
        enabled: true,
        timeoutMs: 1_000,
        apiKey: 'test-key'
      })
      return { settings: settings.ok, background: background.ok, model: model.ok }
    }, modelFixture.baseUrl)
    expect(prepared).toEqual({ settings: true, background: true, model: true })
    await page.evaluate(() => { window.location.hash = '#/home' })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await setWindowSize(electronApp, page, 1440, 900)

    await page.getByRole('button', { name: '开始新手体验' }).click()
    await page.getByRole('button', { name: '下一步' }).click()
    await page.getByRole('button', { name: '去问助教' }).click()
    await page.getByRole('button', { name: '试着解释这段循环' }).click()
    await page.locator('.runs-composer .agent-composer button[type="submit"]').click()

    await expect(page.locator('.approval-card')).toContainText('发送上下文到 OpenAI 模型', { timeout: 30_000 })
    await expect(page.locator('[data-tour="assistant-approval"]')).toBeVisible()
    await expect(page.locator('.product-tour-status')).toContainText('需要你的确认')
    await expectTourNotToOverlapTarget(page, 'assistant-approval')
    await captureWindow(electronApp, page, 'beginner-tour-approval-1440x900.png')
    await page.getByRole('button', { name: '批准', exact: true }).click()

    await expect(page.locator('[data-tour="assistant-result"]')).toContainText('循环', { timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: '看懂助教结果' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
