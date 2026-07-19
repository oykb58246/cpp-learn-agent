import { expect, test, _electron as electron, type Page } from '@playwright/test'
import electronPath from 'electron'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createElectronEnvironment,
  startStreamingModelFixture,
  type StreamingModelFixture
} from './electron-env'

const repo = resolve(import.meta.dirname, '../..')
const scenario = (name: string) => `E2E_SCENARIO:${name}`

let temp = ''
let modelFixture: StreamingModelFixture

test.beforeEach(async () => {
  temp = mkdtempSync(join(tmpdir(), 'cpppilot-openai-protocol-'))
  mkdirSync(join(temp, 'workspace'))
  modelFixture = await startStreamingModelFixture()
})

test.afterEach(async () => {
  await modelFixture.close()
  rmSync(temp, { recursive: true, force: true })
})

async function launch() {
  return electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--in-process-gpu', '--no-sandbox', join(repo, 'apps/desktop')],
    env: createElectronEnvironment({
      CPP_PET_USER_DATA: join(temp, 'user-data'),
      CPP_PET_E2E_SEED_ROOT: join(temp, 'workspace')
    })
  })
}

async function prepare(page: Page, options: {
  configureModel?: boolean
  bindToolchain?: boolean
  source?: string
} = {}) {
  const { configureModel = true, bindToolchain = false, source } = options
  return page.evaluate(async ({ baseUrl, configureModel, bindToolchain, source }) => {
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
    if (bindToolchain) {
      const detected = await window.cppPet.toolchains.detect()
      if (!detected.ok || !detected.data.candidates[0]) return { error: 'NO_TOOLCHAIN' }
      const candidate = detected.data.candidates.find(item => item.family === 'gcc') ?? detected.data.candidates[0]
      const bound = await window.cppPet.toolchains.bind({ candidateId: candidate.id })
      if (!bound.ok) return { error: bound.error.code }
    }
    const bootstrap = await window.cppPet.app.getBootstrap()
    if (!bootstrap.ok || !bootstrap.data.recentProjects[0]) return { error: 'NO_PROJECT' }
    const project = bootstrap.data.recentProjects[0]
    const document = await window.cppPet.files.read({ projectId: project.id, relativePath: 'main.cpp' })
    if (!document.ok) return { error: document.error.code }
    if (source !== undefined) {
      const written = await window.cppPet.files.write({
        projectId: project.id,
        relativePath: 'main.cpp',
        expectedHash: document.data.contentHash,
        content: source,
        createSnapshot: false
      })
      if (!written.ok) return { error: written.error.code }
    }
    if (configureModel) {
      const model = await window.cppPet.model.save({
        name: 'OpenAI protocol E2E model',
        baseUrl,
        model: 'gpt-5',
        enabled: true,
        timeoutMs: 10_000,
        apiKey: 'fixture-key'
      })
      if (!model.ok) return { error: model.error.code }
    }
    return { projectId: project.id, initialContent: source ?? document.data.content }
  }, { baseUrl: modelFixture.baseUrl, configureModel, bindToolchain, source })
}

async function openAgent(page: Page, projectId: string) {
  await page.evaluate(id => { window.location.hash = `#/workspace/${id}` }, projectId)
  await page.reload()
  await expect(page.locator('.workspace-view')).toBeVisible()
  await page.getByText('main.cpp', { exact: true }).click()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(page.locator('.workspace-agent-panel')).toBeVisible()
}

async function submitPrompt(page: Page, prompt: string) {
  const composer = page.locator('.workspace-agent-panel .agent-composer')
  await composer.locator('textarea').fill(prompt)
  await composer.locator('button[type="submit"]').click()
}

async function decideApproval(page: Page, toolName: string, decision: 'approved' | 'rejected') {
  const approval = page.locator('.workspace-agent-panel .approval-card')
  await expect(approval).toContainText(toolName, { timeout: 30_000 })
  await approval.locator(decision === 'approved' ? '.primary-command' : '.secondary-command').click()
}

async function latestRun(page: Page) {
  return page.evaluate(async () => {
    const runs = await window.cppPet.agent.list({ limit: 10 })
    return runs.ok ? runs.data[0] ?? null : null
  })
}

async function latestRunDetail(page: Page) {
  return page.evaluate(async () => {
    const runs = await window.cppPet.agent.list({ limit: 10 })
    if (!runs.ok || !runs.data[0]) return null
    const detail = await window.cppPet.agent.get({ runId: runs.data[0].id })
    return detail.ok ? detail.data : null
  })
}

async function waitForRunStatus(page: Page, status: string) {
  await expect.poll(async () => (await latestRun(page))?.status, { timeout: 60_000 }).toBe(status)
  return latestRunDetail(page)
}

test('fails locally without sending a request when no model is configured', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page, { configureModel: false })
    expect(prepared).toHaveProperty('projectId')
    await openAgent(page, (prepared as { projectId: string }).projectId)

    await submitPrompt(page, scenario('model-not-configured'))

    const run = await waitForRunStatus(page, 'failed')
    expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_NOT_CONFIGURED' })
    await expect(page.locator('.conversation-message.assistant.failed').last()).toBeVisible()
    expect(modelFixture.requests).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('surfaces a native OpenAI refusal as a failed run', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await openAgent(page, (prepared as { projectId: string }).projectId)

    await submitPrompt(page, scenario('refusal'))
    await decideApproval(page, 'model.remote-context', 'approved')

    const run = await waitForRunStatus(page, 'failed')
    expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_REFUSED' })
    await expect(page.locator('.conversation-message.assistant.failed').last()).toContainText('E2E refusal')
    expect(modelFixture.requests).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('rejects a malformed final response after one structured repair turn', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await openAgent(page, (prepared as { projectId: string }).projectId)

    await submitPrompt(page, scenario('invalid-final'))
    await decideApproval(page, 'model.remote-context', 'approved')

    const run = await waitForRunStatus(page, 'failed')
    expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROTOCOL_INVALID' })
    expect(modelFixture.requests).toHaveLength(2)
    expect(JSON.stringify(modelFixture.requests[1]?.input)).toContain('previous final response was invalid')
  } finally {
    await app.close()
  }
})

test('continues a clarification answer on the same run', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await openAgent(page, (prepared as { projectId: string }).projectId)

    await submitPrompt(page, scenario('clarification'))
    await decideApproval(page, 'model.remote-context', 'approved')

    const waiting = await waitForRunStatus(page, 'waiting-input')
    expect(waiting?.pendingClarification?.question).toBe('Which file should I update?')
    const originalRunId = waiting!.id
    const composer = page.locator('.workspace-agent-panel .agent-composer')
    await expect(composer.locator('textarea')).toBeEnabled()
    await submitPrompt(page, 'main.cpp')

    const completed = await waitForRunStatus(page, 'completed')
    expect(completed?.id).toBe(originalRunId)
    await expect(page.locator('.conversation-message.assistant.completed').last()).toContainText('main.cpp')
    expect(modelFixture.requests).toHaveLength(2)
    expect(JSON.stringify(modelFixture.requests[1]?.input)).toContain('main.cpp')
  } finally {
    await app.close()
  }
})

test('returns a rejected tool approval to the model without changing the file', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    const { projectId, initialContent } = prepared as { projectId: string; initialContent: string }
    await openAgent(page, projectId)

    await submitPrompt(page, scenario('approval-rejection'))
    await decideApproval(page, 'model.remote-context', 'approved')
    await decideApproval(page, 'workspace.apply_patch', 'rejected')

    const run = await waitForRunStatus(page, 'failed')
    expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_REPORTED_FAILURE' })
    const rejectedOutput = modelFixture.requests[1]?.input?.find(item => item.type === 'function_call_output')
    expect(rejectedOutput?.call_id).toBe(`reject_${run!.requestId}`)
    expect(JSON.parse(String(rejectedOutput?.output))).toMatchObject({ ok: false, errorCode: 'TOOL_REJECTED' })
    const content = await page.evaluate(async ({ projectId }) => {
      const document = await window.cppPet.files.read({ projectId, relativePath: 'main.cpp' })
      return document.ok ? document.data.content : null
    }, { projectId })
    expect(content).toBe(initialContent)
  } finally {
    await app.close()
  }
})

test('recovers from a real compiler failure, edits the file, and validates again', async () => {
  test.setTimeout(180_000)
  const brokenSource = '#include <iostream>\nint main() {\n  std::cout << "recover" << std::endl\n  return 0;\n}\n'
  const fixedSource = '#include <iostream>\nint main() {\n  std::cout << "recover" << std::endl;\n  return 0;\n}\n'
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page, { bindToolchain: true, source: brokenSource })
    expect(prepared).toHaveProperty('projectId')
    const projectId = (prepared as { projectId: string }).projectId
    await openAgent(page, projectId)

    await submitPrompt(page, scenario('tool-recovery'))
    await decideApproval(page, 'model.remote-context', 'approved')
    await decideApproval(page, 'workspace.apply_patch', 'approved')

    const run = await waitForRunStatus(page, 'completed')
    expect(run?.toolCalls.map(call => ({ tool: call.toolName, status: call.status, ok: call.result?.ok }))).toEqual([
      { tool: 'compiler.build', status: 'failed', ok: false },
      { tool: 'workspace.apply_patch', status: 'completed', ok: true },
      { tool: 'compiler.build', status: 'completed', ok: true }
    ])
    const buildOutputs = (modelFixture.requests.at(-1)?.input ?? [])
      .filter(item => item.type === 'function_call_output')
      .map(item => ({ callId: item.call_id, output: JSON.parse(String(item.output)) }))
      .filter(item => item.output.tool === 'compiler.build')
    expect(buildOutputs.map(item => ({ callId: item.callId, ok: item.output.ok }))).toEqual([
      { callId: `recovery_build_initial_${run!.requestId}`, ok: false },
      { callId: `recovery_build_final_${run!.requestId}`, ok: true }
    ])
    const content = await page.evaluate(async ({ projectId }) => {
      const document = await window.cppPet.files.read({ projectId, relativePath: 'main.cpp' })
      return document.ok ? document.data.content : null
    }, { projectId })
    expect(content).toBe(fixedSource)
  } finally {
    await app.close()
  }
})
