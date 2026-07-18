import { test, expect, _electron as electron } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
const request = '帮我把 main.cpp 中的"Hello, C++Pilot!"改成"Hello, world!"，编译成功后再解释 main、cout 和 endl 的作用'

test('修改代码、编译验证并解释指定概念', async () => {
  test.setTimeout(180_000)
  const temp = mkdtempSync(join(tmpdir(), 'cpppilot-agent-edit-'))
  const workspaceRoot = join(temp, 'workspace')
  mkdirSync(workspaceRoot)
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({
      CPP_PET_USER_DATA: join(temp, 'user-data'),
      CPP_PET_E2E_SEED_ROOT: workspaceRoot
    })
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const setup = await page.evaluate(async () => {
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
        content: '#include <iostream>\nusing namespace std;\n\nint Main() {\n    cout << "Hello, C++Pilot!" << endl;\n    return 0;\n}\n',
        createSnapshot: false
      })
      return written.ok ? { projectId: project.id } : { error: written.error.code }
    })
    expect(setup).toHaveProperty('projectId')
    const projectId = (setup as { projectId: string }).projectId

    await page.evaluate(id => { window.location.hash = `#/workspace/${id}` }, projectId)
    await page.reload()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await page.getByText('main.cpp', { exact: true }).click()
    await expect(page.locator('.monaco-editor-host')).toContainText('Hello, C++Pilot!')
    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await page.getByPlaceholder('向 CppPilot 提交学习任务').fill(request)
    await page.getByRole('button', { name: '发送', exact: true }).click()

    await expect(page.locator('.approval-card')).toContainText('Apply requested file edit', { timeout: 30_000 })
    await expect(page.locator('.approval-diff')).toContainText('-int Main()')
    await expect(page.locator('.approval-diff')).toContainText('+int main()')
    await expect(page.locator('.approval-diff')).toContainText('-    cout << "Hello, C++Pilot!" << endl;')
    await expect(page.locator('.approval-diff')).toContainText('+    cout << "Hello, world!" << endl;')
    await page.getByRole('button', { name: '批准', exact: true }).click()

    await expect(page.locator('.workspace-agent-panel')).toContainText('completed', { timeout: 60_000 })
    await expect(page.locator('.conversation-transcript')).toContainText('main')
    await expect(page.locator('.conversation-transcript')).toContainText('cout')
    await expect(page.locator('.conversation-transcript')).toContainText('endl')
    await expect(page.locator('.conversation-transcript')).toContainText(/compil|build|编译/i)
    await expect(page.locator('.monaco-editor-host')).toContainText('Hello, world!', { timeout: 10_000 })
    await expect(page.locator('.monaco-editor-host')).toContainText('int main()')

    const evidence = await page.evaluate(async id => {
      const document = await window.cppPet.files.read({ projectId: id, relativePath: 'main.cpp' })
      const runs = await window.cppPet.agent.list({ limit: 10 })
      if (!document.ok || !runs.ok || !runs.data[0]) return null
      const detail = await window.cppPet.agent.get({ runId: runs.data[0].id })
      if (!detail.ok) return null
      return {
        content: document.data.content,
        status: detail.data.status,
        tools: detail.data.toolCalls.map(call => ({ name: call.toolName, status: call.status, ok: call.result?.ok }))
      }
    }, projectId)
    expect(evidence).toEqual({
      content: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, world!" << endl;\n    return 0;\n}\n',
      status: 'completed',
      tools: [
        { name: 'workspace.read_file', status: 'completed', ok: true },
        { name: 'workspace.apply_patch', status: 'completed', ok: true },
        { name: 'compiler.build', status: 'completed', ok: true }
      ]
    })
  } finally {
    await electronApp.close()
    rmSync(temp, { recursive: true, force: true })
  }
})
