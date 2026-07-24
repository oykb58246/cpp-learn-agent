import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment, findMainApplicationWindow, setWorkspaceAgentOpen, startStreamingModelFixture, type StreamingModelFixture } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
let temp = ''
let modelFixture: StreamingModelFixture

test.beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), 'cpppilot-conversation-e2e-'))
  mkdirSync(join(temp, 'workspace'))
  mkdirSync(join(repo, 'test-results', 'visual'), { recursive: true })
  modelFixture = await startStreamingModelFixture()
})
test.afterEach(async () => {
  await modelFixture.close()
  rmSync(temp, { recursive: true, force: true })
})

async function launch(userData = join(temp, 'user-data')) {
  return electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({ CPP_PET_USER_DATA: userData, CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace') })
  })
}

async function prepare(page: Page) {
  const source = readFileSync(join(repo, 'tests/fixtures-cpp/duplicate-syntax-errors/main.cpp'), 'utf8')
  return page.evaluate(async ({ baseUrl, source }) => {
    await window.cppPet.settings.update({
      onboardingCompleted: true,
      onboardingStatus: 'completed',
      productTourStatus: 'dismissed',
      productTourWelcomeSeen: true
    })
    await window.cppPet.learning.saveBackground({
      onboardingCompleted: true,
      startingPoint: 'zero-beginner',
      studiedConceptIds: [],
      focusConceptIds: []
    })
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
      content: source,
      createSnapshot: false
    })
    if (!written.ok) return { error: written.error.code }
    const model = await window.cppPet.model.save({
      name: 'E2E streaming model', baseUrl, model: 'teacher', enabled: true, timeoutMs: 10_000, apiKey: 'fixture-key'
    })
    return model.ok ? { projectId: project.id } : { error: model.error.code }
  }, { baseUrl: modelFixture.baseUrl, source })
}

async function openProject(page: Page, projectId: string) {
  await page.evaluate(id => { window.location.hash = `#/workspace/${id}` }, projectId)
  await page.reload()
  await expect(page.locator('.workspace-view')).toBeVisible()
  await page.getByText('main.cpp', { exact: true }).click()
}

async function approveModelContext(page: Page) {
  await expect(page.locator('.approval-card')).toContainText('发送上下文到 OpenAI 模型', { timeout: 30_000 })
  await page.getByRole('button', { name: '批准', exact: true }).click()
}

async function capture(electronApp: ElectronApplication, page: Page, name: string) {
  const browserWindow = await electronApp.browserWindow(page)
  const png = await browserWindow.evaluate(async win => (await win.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(repo, 'test-results', 'visual', name), Buffer.from(png, 'base64'))
}

test('places Agent in the right sidebar and opens snapshots on demand', async () => {
  const electronApp = await launch(join(temp, 'workspace-layout-user-data'))
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    const projectId = (prepared as { projectId: string }).projectId
    await openProject(page, projectId)

    await setWorkspaceAgentOpen(page, false)
    await expect(page.locator('.workspace-inspector')).toHaveCount(0)
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-inspector .conversation-panel')).toBeVisible()
    await expect(page.locator('.editor-area > .conversation-panel')).toHaveCount(0)

    const history = page.getByRole('button', { name: '快照', exact: true })
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)
    await history.click()
    await expect(page.getByRole('dialog', { name: '项目快照' })).toBeVisible()
    await expect(history).toHaveAttribute('aria-expanded', 'true')

    await page.getByRole('textbox', { name: '快照标签' }).fill('布局检查点')
    await page.getByRole('button', { name: '创建', exact: true }).click()
    const manualSnapshot = page.locator('.snapshot-list article').filter({ hasText: '布局检查点' })
    await expect(manualSnapshot).toBeVisible()
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    await manualSnapshot.getByRole('button', { name: '恢复快照' }).click()
    await expect(page.locator('.monaco-editor-host')).toHaveCount(0)
    await manualSnapshot.getByRole('button', { name: '删除快照' }).click()
    await expect(manualSnapshot).toHaveCount(0)
    await page.getByText('main.cpp', { exact: true }).click()
    await expect(page.locator('.monaco-editor-host')).toBeVisible()
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    await history.click()
    await page.getByRole('button', { name: '关闭快照' }).click()
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    await history.click()
    await page.locator('.editor-toolbar').click({ position: { x: 4, y: 4 } })
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    await history.click()
    await history.click()
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    await history.click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    const editorRight = await page.locator('.editor-area').evaluate(element => element.getBoundingClientRect().right)
    const agentLeft = await page.locator('.workspace-agent-inspector').evaluate(element => element.getBoundingClientRect().left)
    expect(Math.abs(editorRight - agentLeft)).toBeLessThanOrEqual(1)

    await history.click()
    await capture(electronApp, page, 'workspace-agent-sidebar-1440x900.png')
    const browserWindow = await electronApp.browserWindow(page)
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const overlap = await page.evaluate(() => {
      const editor = document.querySelector('.editor-area')!.getBoundingClientRect()
      const agent = document.querySelector('.workspace-agent-inspector')!.getBoundingClientRect()
      const popover = document.querySelector('.snapshot-popover')!.getBoundingClientRect()
      return {
        editorAgent: editor.right > agent.left + 1,
        popoverAgent: popover.right > agent.left + 1
      }
    })
    expect(overlap).toEqual({ editorAgent: false, popoverAgent: false })
    await capture(electronApp, page, 'workspace-agent-sidebar-1024x720.png')

    await page.evaluate(() => window.cppPet.settings.update({ theme: 'dark' }))
    await browserWindow.evaluate(win => win.setSize(1440, 900))
    await openProject(page, projectId)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await setWorkspaceAgentOpen(page, true)
    await history.click()
    await expect(page.getByRole('dialog', { name: '项目快照' })).toBeVisible()
    await capture(electronApp, page, 'workspace-agent-sidebar-dark-1440x900.png')

    await page.getByRole('button', { name: '关闭快照' }).click()
    await setWorkspaceAgentOpen(page, false)
    await expect(page.locator('.workspace-inspector')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('keeps the Agent trigger reachable and independent from the diagnostic inbox on narrow windows', async () => {
  const electronApp = await launch(join(temp, 'agent-trigger-user-data'))
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await openProject(page, (prepared as { projectId: string }).projectId)
    const browserWindow = await electronApp.browserWindow(page)
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    await setWorkspaceAgentOpen(page, false)

    const agentTrigger = page.getByRole('button', { name: 'Agent', exact: true })
    await expect(agentTrigger).toBeVisible()
    expect(await agentTrigger.evaluate(element => {
      const box = element.getBoundingClientRect()
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return box.left >= 0 && box.right <= window.innerWidth && target instanceof Node && element.contains(target)
    })).toBe(true)

    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-inspector')).toBeVisible()
    await capture(electronApp, page, 'agent-trigger-narrow-1024x720.png')
    await setWorkspaceAgentOpen(page, false)
    await expect(page.locator('.workspace-agent-inspector')).toHaveCount(0)

    await page.getByRole('button', { name: '编译', exact: true }).click()
    await expect(page.locator('.agent-inbox-badge')).toHaveText('1', { timeout: 30_000 })
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.workspace-agent-inspector')).toBeVisible()
    await expect(page.getByRole('dialog', { name: '错误收件箱' })).toHaveCount(0)
    await setWorkspaceAgentOpen(page, false)
    await page.getByRole('button', { name: '错误收件箱', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '错误收件箱' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('persists a grouped diagnostic inbox and explains it in a streamed project conversation', async () => {
  test.setTimeout(180_000)
  let electronApp = await launch()
  let page = await findMainApplicationWindow(electronApp)
  await page.waitForLoadState('domcontentloaded')
  const prepared = await prepare(page)
  expect(prepared).toHaveProperty('projectId')
  const projectId = (prepared as { projectId: string }).projectId
  await openProject(page, projectId)

  await page.getByRole('button', { name: '编译', exact: true }).click()
  await expect(page.locator('.agent-inbox-badge')).toHaveText('1', { timeout: 30_000 })
  await expect(page.locator('.agent-inbox-toggle')).toHaveClass(/attention/)
  await page.getByRole('button', { name: '错误收件箱', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '错误收件箱' })).toBeVisible()
  await expect(page.locator('.diagnostic-group-summary')).toContainText('2 处')
  await expect(page.locator('.agent-inbox-toggle')).not.toHaveClass(/attention/)
  await expect(page.locator('.agent-inbox-badge')).toHaveText('1')

  await electronApp.close()
  electronApp = await launch()
  page = await findMainApplicationWindow(electronApp)
  await page.waitForLoadState('domcontentloaded')
  await openProject(page, projectId)
  await expect(page.locator('.agent-inbox-badge')).toHaveText('1')
  await page.getByRole('button', { name: '错误收件箱', exact: true }).click()
  await page.locator('.diagnostic-group-summary').click()
  await page.getByRole('button', { name: '创建新对话' }).click()
  await approveModelContext(page)
  await expect(page.locator('.workspace-agent-panel')).toBeVisible()
  await expect(page.locator('.conversation-transcript')).toContainText('先看共同原因', { timeout: 30_000 })
  await expect(page.locator('.conversation-transcript')).toContainText('两个出现位置')
  await capture(electronApp, page, 'agent-conversation-inbox-1440x900.png')

  const browserWindow = await electronApp.browserWindow(page)
  await browserWindow.evaluate(win => win.setSize(1024, 720))
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await capture(electronApp, page, 'agent-conversation-panel-1024x720.png')
  await browserWindow.evaluate(win => win.setSize(1440, 900))

  const editor = page.locator('.monaco-editor-host .monaco-editor')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('#include <iostream>\nint main() {\n  int first = 1;\n  int second = 2;\n  std::cout << first + second << "\\n";\n  return 0;\n}\n')
  await page.getByRole('button', { name: '编译', exact: true }).click()
  await expect(page.locator('.agent-inbox-badge')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.conversation-transcript')).toContainText('先看共同原因')
  await electronApp.close()
})

test('renders assistant Markdown and removes unsafe HTML', async () => {
  const electronApp = await launch(join(temp, 'markdown-user-data'))
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await page.evaluate(() => window.cppPet.settings.update({ theme: 'dark' }))
    await openProject(page, (prepared as { projectId: string }).projectId)
    await expect(page.locator('html')).toHaveClass(/dark/)

    await setWorkspaceAgentOpen(page, true)
    await page.getByPlaceholder('随心输入').fill('Markdown 渲染测试')
    await page.locator('.workspace-agent-panel .agent-composer button[type="submit"]').click()
    await approveModelContext(page)

    const reply = page.locator('.conversation-message.assistant').last()
    await expect(reply.locator('.message-markdown')).toBeVisible({ timeout: 30_000 })
    await expect(reply.getByRole('heading', { name: '修复建议' })).toBeVisible()
    await expect(reply.locator('.message-markdown strong')).toHaveText('粗体结论')
    await expect(reply.locator('code').filter({ hasText: 'inline code' })).toBeVisible()
    await expect(reply.locator('pre code.language-cpp')).toContainText('std::cout')
    await expect(reply.locator('blockquote')).toContainText('引用说明')
    await expect(reply.locator('li')).toHaveText('列表项')
    await expect(reply.locator('table')).toContainText('Markdown')
    await expect(reply.locator('img, script')).toHaveCount(0)
    await expect(reply.getByText('恶意链接')).not.toHaveAttribute('href', /.+/)
    expect(await page.evaluate(() => ({ xss: document.body.dataset.markdownXss, script: document.body.dataset.markdownScript }))).toEqual({})
    await capture(electronApp, page, 'agent-markdown-dark-1440x900.png')

    const browserWindow = await electronApp.browserWindow(page)
    await browserWindow.evaluate(win => win.setSize(1024, 720))
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await reply.locator('.message-markdown').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await capture(electronApp, page, 'agent-markdown-dark-1024x720.png')
  } finally {
    await electronApp.close()
  }
})

test('keeps conversations isolated by project and supports stopping then retrying a stream', async () => {
  test.setTimeout(120_000)
  const electronApp = await launch(join(temp, 'isolation-user-data'))
  try {
    const page = await findMainApplicationWindow(electronApp)
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    const firstProjectId = (prepared as { projectId: string }).projectId
    await openProject(page, firstProjectId)
    await setWorkspaceAgentOpen(page, true)
    await page.getByPlaceholder('随心输入').fill('停止测试')
    await page.locator('.workspace-agent-panel .agent-composer button[type="submit"]').click()
    await approveModelContext(page)
    const stopAgent = page.locator('.workspace-agent-panel .agent-composer .composer-send.stop')
    await expect(stopAgent).toBeVisible({ timeout: 30_000 })
    await stopAgent.click()
    await expect(page.locator('.conversation-message.stopped')).toBeVisible()
    await page.locator('.conversation-message.stopped').getByRole('button', { name: '重试' }).click()
    await approveModelContext(page)
    await expect(page.locator('.conversation-transcript')).toContainText('这次回答已经完成', { timeout: 30_000 })

    const second = await page.evaluate(async () => {
      const bootstrap = await window.cppPet.app.getBootstrap()
      if (!bootstrap.ok || !bootstrap.data.workspaces[0]) return null
      const draft = await window.cppPet.project.preview({ mode: 'manual', workspaceId: bootstrap.data.workspaces[0].id, name: '隔离项目', type: 'single-file' })
      if (!draft.ok) return null
      const created = await window.cppPet.project.create({ draftId: draft.data.draftId })
      return created.ok ? created.data : null
    })
    expect(second).not.toBeNull()
    await openProject(page, second!.id)
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.conversation-transcript')).not.toContainText('停止测试')
    await openProject(page, firstProjectId)
    await setWorkspaceAgentOpen(page, true)
    await expect(page.locator('.conversation-transcript')).toContainText('停止测试')
  } finally {
    await electronApp.close()
  }
})
