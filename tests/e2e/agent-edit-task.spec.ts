import { test, expect, _electron as electron } from '@playwright/test'
import electronPath from 'electron'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronEnvironment, findMainApplicationWindow, setWorkspaceAgentOpen, startStreamingModelFixture } from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
const request = '帮我把 main.cpp 中的"Hello, C++Pilot!"改成"Hello, world!，编译成功后再解释 main、cout 和 endl 的作用。'

test('修改代码、编译验证并解释指定概念', async () => {
  test.setTimeout(180_000)
  const temp = mkdtempSync(join(tmpdir(), 'cpppilot-agent-edit-'))
  const workspaceRoot = join(temp, 'workspace')
  mkdirSync(workspaceRoot)
  const modelFixture = await startStreamingModelFixture()
  const electronApp = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({
      CPP_PET_USER_DATA: join(temp, 'user-data'),
      CPP_PET_E2E_SEED_ROOT: workspaceRoot
    })
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
        content: '#include <iostream>\nusing namespace std;\n\nint Main() {\n    cout << "Hello, C++Pilot!" << endl;\n    return 0;\n}\n',
        createSnapshot: false
      })
      if (!written.ok) return { error: written.error.code }
      const model = await window.cppPet.model.save({
        name: 'Responses E2E model', baseUrl, model: 'gpt-5', enabled: true, timeoutMs: 10_000, apiKey: 'fixture-key'
      })
      return model.ok ? { projectId: project.id } : { error: model.error.code }
    }, modelFixture.baseUrl)
    expect(setup).toHaveProperty('projectId')
    const projectId = (setup as { projectId: string }).projectId

    await page.evaluate(id => { window.location.hash = `#/workspace/${id}` }, projectId)
    await page.reload()
    await expect(page.locator('.workspace-view')).toBeVisible()
    await page.getByText('main.cpp', { exact: true }).click()
    await expect(page.locator('.monaco-editor-host')).toContainText('Hello, C++Pilot!')
    await setWorkspaceAgentOpen(page, true)
    await page.getByPlaceholder('随心输入').fill(request)
    await page.locator('.workspace-agent-panel .agent-composer button[type="submit"]').click()

    await expect(page.locator('.approval-card')).toContainText('发送上下文到 OpenAI 模型', { timeout: 30_000 })
    await page.getByRole('button', { name: '批准', exact: true }).click()

    await expect(page.locator('.approval-card')).toContainText('应用文件修改', { timeout: 30_000 })
    await expect(page.locator('.approval-diff')).toContainText('-int Main()')
    await expect(page.locator('.approval-diff')).toContainText('+int main()')
    await expect(page.locator('.approval-diff')).toContainText('-    cout << "Hello, C++Pilot!" << endl;')
    await expect(page.locator('.approval-diff')).toContainText('+    cout << "Hello, world!" << endl;')
    await page.getByRole('button', { name: '批准', exact: true }).click()

    await expect(page.locator('.workspace-agent-panel')).toContainText('completed', { timeout: 60_000 })
    const finalAssistantMessage = page.locator('.conversation-message.assistant').last()
    await expect(finalAssistantMessage).toContainText('main')
    await expect(finalAssistantMessage).toContainText('cout')
    await expect(finalAssistantMessage).toContainText('endl')
    await expect(finalAssistantMessage).toContainText(/compil|build|编译/i)
    await expect(page.locator('.monaco-editor-host')).toContainText('Hello, world!', { timeout: 10_000 })
    await expect(page.locator('.monaco-editor-host')).toContainText('int main()')

    const evidence = await page.evaluate(async id => {
      const document = await window.cppPet.files.read({ projectId: id, relativePath: 'main.cpp' })
      const runs = await window.cppPet.agent.list({ limit: 10 })
      if (!document.ok || !runs.ok || !runs.data[0]) return null
      const detail = await window.cppPet.agent.get({ runId: runs.data[0].id })
      if (!detail.ok) return null
      return {
        runId: detail.data.id,
        content: document.data.content,
        status: detail.data.status,
        tools: detail.data.toolCalls.map(call => ({
          name: call.toolName,
          status: call.status,
          ok: call.result?.ok,
          argumentRunId: call.parameterSummary.runId
        }))
      }
    }, projectId)
    expect(evidence).toMatchObject({
      content: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, world!" << endl;\n    return 0;\n}\n',
      status: 'completed',
      tools: [
        { name: 'workspace.read_file', status: 'completed', ok: true },
        { name: 'workspace.apply_patch', status: 'completed', ok: true },
        { name: 'compiler.build', status: 'completed', ok: true, argumentRunId: evidence?.runId }
      ]
    })
    const firstContextRequest = modelFixture.requests.find(item => (item.input as any[])?.some(input => input.role === 'user'))
    const contextText = (firstContextRequest?.input as any[])?.find(input => input.role === 'user')?.content?.[0]?.text
    expect(JSON.parse(contextText).task.prompt).toBe(request)
    const compilerTool = (firstContextRequest?.tools as any[])?.find(tool => tool.name === 'compiler_build')
    expect(compilerTool?.parameters?.properties).not.toHaveProperty('runId')
    expect(compilerTool?.parameters?.required).not.toContain('runId')
    expect(modelFixture.requests.some(item => JSON.stringify(item).includes('compiler.build'))).toBe(true)
  } finally {
    await electronApp.close()
    await modelFixture.close()
    rmSync(temp, { recursive: true, force: true })
  }
})
