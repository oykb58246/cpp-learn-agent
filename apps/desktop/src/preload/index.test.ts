import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '@cpp-pet/contracts/ipc'

function setupPreloadMock() {
  let exposedApi: any
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const invoke = vi.fn()
  const on = vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    listeners.set(channel, listener)
  })
  const removeListener = vi.fn()

  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
        exposedApi = api
      })
    },
    ipcRenderer: {
      invoke,
      on,
      removeListener
    }
  }))

  return { get exposedApi() { return exposedApi }, listeners, invoke, on, removeListener }
}

describe('preload pet API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exposes app navigation events from the main process', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    const listener = vi.fn()
    const stop = mock.exposedApi.app.onNavigate(listener)
    const event = { path: '/settings' }
    mock.listeners.get(ipc.appNavigate)?.({}, event)
    expect(listener).toHaveBeenCalledWith(event)
    stop()
    expect(mock.removeListener).toHaveBeenCalledWith(ipc.appNavigate, expect.any(Function))
  })

  it('copies text through the fixed app clipboard channel', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    await mock.exposedApi.app.copyText({ text: 'src/main.cpp' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.appCopyText, { text: 'src/main.cpp' })
  })

  it('exposes onChanged and keeps onEvent as a compatibility alias', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    expect(typeof mock.exposedApi.pet.onChanged).toBe('function')
    expect(typeof mock.exposedApi.pet.onEvent).toBe('function')

    const changedListener = vi.fn()
    const stopChanged = mock.exposedApi.pet.onChanged(changedListener)
    const event = { eventId: crypto.randomUUID(), state: 'success', message: '任务已完成' }
    mock.listeners.get(ipc.petChanged)?.({}, event)
    expect(changedListener).toHaveBeenCalledWith(event)
    stopChanged()
    expect(mock.removeListener).toHaveBeenCalledWith(ipc.petChanged, expect.any(Function))

    const eventListener = vi.fn()
    mock.exposedApi.pet.onEvent(eventListener)
    mock.listeners.get(ipc.petChanged)?.({}, event)
    expect(eventListener).toHaveBeenCalledWith(event)
  })

  it('exposes pet window commands and state changes through fixed IPC channels', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    await mock.exposedApi.pet.getState()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petGetState, undefined)

    const patch = { assetMode: 'salary-cat', scale: 1.25 }
    await mock.exposedApi.pet.updateSettings(patch)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petUpdateSettings, patch)

    await mock.exposedApi.pet.show()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petShow, undefined)
    await mock.exposedApi.pet.hide()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petHide, undefined)
    await mock.exposedApi.pet.toggle()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petToggle, undefined)
    await mock.exposedApi.pet.move({ deltaX: 8, deltaY: -4 })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petMove, { deltaX: 8, deltaY: -4 })
    const drag = { initialBounds: { x: 10, y: 20, width: 220, height: 260 }, pointerStartScreenX: 1, pointerStartScreenY: 2, pointerCurrentScreenX: 3, pointerCurrentScreenY: 4 }
    await mock.exposedApi.pet.drag(drag)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petDrag, drag)
    await mock.exposedApi.pet.setIgnoreMouseEvents({ ignoreMouseEvents: true })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petSetIgnoreMouseEvents, { ignoreMouseEvents: true })
    await mock.exposedApi.pet.openMain()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petOpenMain, undefined)
    await mock.exposedApi.pet.showContextMenu()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petShowContextMenu, undefined)
    await mock.exposedApi.pet.selectCustomAsset({ name: '课堂猫' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petSelectCustomAsset, { name: '课堂猫' })
    await mock.exposedApi.pet.resetCustomAsset()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petResetCustomAsset, undefined)
    await mock.exposedApi.pet.renameCustomAsset({ assetId: 'asset-1', name: '猫猫' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petRenameCustomAsset, { assetId: 'asset-1', name: '猫猫' })
    await mock.exposedApi.pet.deleteCustomAsset({ assetId: 'asset-1' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petDeleteCustomAsset, { assetId: 'asset-1' })
    await mock.exposedApi.pet.activateCustomAsset({ assetId: 'asset-2' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petActivateCustomAsset, { assetId: 'asset-2' })
    await mock.exposedApi.pet.hideForOneHour()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petHideForOneHour, undefined)
    await mock.exposedApi.pet.cancelHidden()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petCancelHidden, undefined)
    await mock.exposedApi.pet.toggleFocusMode({ enabled: true })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petToggleFocusMode, { enabled: true })
    await mock.exposedApi.pet.toggleLaunchAtLogin({ enabled: true })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petToggleLaunchAtLogin, { enabled: true })
    await mock.exposedApi.pet.chat({ message: '解释这段代码' })
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.petChat, { message: '解释这段代码' })

    const quickChatListener = vi.fn()
    const stopQuickChat = mock.exposedApi.pet.onQuickChat(quickChatListener)
    mock.listeners.get(ipc.petQuickChat)?.({})
    expect(quickChatListener).toHaveBeenCalledOnce()
    stopQuickChat()
    expect(mock.removeListener).toHaveBeenCalledWith(ipc.petQuickChat, expect.any(Function))

    const stateListener = vi.fn()
    const stopState = mock.exposedApi.pet.onStateChanged(stateListener)
    const state = { settings: { visible: true, assetMode: 'salary-cat', scale: 1, ignoreMouseEvents: false, bubbleEnabled: true, focusModeEnabled: false, launchAtLogin: false, customAssets: [] }, windowVisible: true, ignoreMouseEvents: false, growthStage: 1, progress: { stage: 1, totalStages: 4, percent: 25, label: '第 1 关 / 共 4 关 · 入门' } }
    mock.listeners.get(ipc.petWindowChanged)?.({}, state)
    expect(stateListener).toHaveBeenCalledWith(state)
    stopState()
    expect(mock.removeListener).toHaveBeenCalledWith(ipc.petWindowChanged, expect.any(Function))
  })

  it('exposes practice catalog, OJ submit and screenshot import channels', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    await mock.exposedApi.learning.practiceCatalog()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.learningPracticeCatalog, undefined)

    const submit = { exerciseId: 'sum', code: 'int main(){}', standard: 'c++17' as const }
    await mock.exposedApi.learning.submitPractice(submit)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.learningPracticeSubmit, submit)

    const complete = { taskId: 'project-gradebook' }
    await mock.exposedApi.learning.completePracticeProject(complete)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.learningPracticeCompleteProject, complete)

    const input = { previewDataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', width: 320, height: 180 }
    await mock.exposedApi.learning.importOjScreenshot(input)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.learningPracticeImportOjScreenshot, input)

    const textInput = {
      kind: 'text',
      fileName: 'problem.md',
      mimeType: 'text/markdown',
      content: '# A + B'
    }
    await mock.exposedApi.learning.importOjScreenshot(textInput)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.learningPracticeImportOjScreenshot, textInput)
  })

  it('exposes the real image capability test channel', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    const input = { profileId: crypto.randomUUID() }
    await mock.exposedApi.model.testVision(input)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.modelTestVision, input)
  })
  it('exposes screenshot capture, submit, cancel and submitted events', async () => {
    const mock = setupPreloadMock()

    await import('./index')

    const captureRequest = { message: '解释这张截图' }
    await mock.exposedApi.screenshot.capture(captureRequest)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.screenshotCapture, captureRequest)

    await mock.exposedApi.screenshot.getPending()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.screenshotGetPending, undefined)

    const submission = { message: '解释这张截图', previewDataUrl: 'data:image/png;base64,AAAA', width: 320, height: 180 }
    await mock.exposedApi.screenshot.submit(submission)
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.screenshotSubmit, submission)

    await mock.exposedApi.screenshot.cancel()
    expect(mock.invoke).toHaveBeenLastCalledWith(ipc.screenshotCancel, undefined)

    const submittedListener = vi.fn()
    const stopSubmitted = mock.exposedApi.screenshot.onSubmitted(submittedListener)
    const submitted = { runId: crypto.randomUUID() }
    mock.listeners.get(ipc.screenshotSubmitted)?.({}, submitted)
    expect(submittedListener).toHaveBeenCalledWith(submitted)
    stopSubmitted()
    expect(mock.removeListener).toHaveBeenCalledWith(ipc.screenshotSubmitted, expect.any(Function))
  })
})
