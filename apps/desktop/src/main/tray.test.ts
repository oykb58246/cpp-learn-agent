import { describe, expect, it, vi } from 'vitest'
import { createPetContextMenuTemplate, createPetTrayMenuTemplate } from './tray'

const callbacks = () => ({
  onOpenMain: vi.fn(),
  onOpenSettings: vi.fn(),
  onTogglePet: vi.fn(),
  onCaptureScreenshot: vi.fn(),
  onQuickChat: vi.fn(),
  onHideForOneHour: vi.fn(),
  onCancelHidden: vi.fn(),
  onToggleFocusMode: vi.fn(),
  onToggleLaunchAtLogin: vi.fn(),
  onToggleMouseEvents: vi.fn(),
  onQuit: vi.fn()
})

const base = () => ({
  petVisible: true,
  ignoreMouseEvents: false,
  focusModeEnabled: false,
  launchAtLogin: false,
  ...callbacks()
})

describe('CppPilot tray menu', () => {
  it('exposes pet, chat, screenshot, focus, launch, settings and exit commands', () => {
    const actions = callbacks()

    const template = createPetTrayMenuTemplate({
      petVisible: true,
      ignoreMouseEvents: false,
      focusModeEnabled: false,
      launchAtLogin: false,
      ...actions
    })

    expect(template.map(item => 'label' in item ? item.label : item.type)).toEqual([
      '打开 CppPilot',
      '快速聊天',
      '隐藏桌宠',
      '隐藏一小时',
      '取消定时隐藏',
      '截图提问',
      '专注模式',
      '开机启动',
      '鼠标穿透',
      '设置',
      'separator',
      '退出'
    ])
    ;(template[0] as any).click()
    ;(template[1] as any).click()
    ;(template[2] as any).click()
    ;(template[3] as any).click()
    ;(template[5] as any).click()
    ;(template[6] as any).click({ checked: true })
    ;(template[7] as any).click({ checked: true })
    ;(template[8] as any).click({ checked: true })
    ;(template[9] as any).click()
    ;(template[11] as any).click()

    expect(actions.onOpenMain).toHaveBeenCalledOnce()
    expect(actions.onQuickChat).toHaveBeenCalledOnce()
    expect(actions.onTogglePet).toHaveBeenCalledOnce()
    expect(actions.onHideForOneHour).toHaveBeenCalledOnce()
    expect(actions.onCaptureScreenshot).toHaveBeenCalledOnce()
    expect(actions.onToggleFocusMode).toHaveBeenCalledWith(true)
    expect(actions.onToggleLaunchAtLogin).toHaveBeenCalledWith(true)
    expect(actions.onToggleMouseEvents).toHaveBeenCalledWith(true)
    expect(actions.onOpenSettings).toHaveBeenCalledOnce()
    expect(actions.onQuit).toHaveBeenCalledOnce()
  })

  it('exposes a native pet context menu without the application quit command', () => {
    const template = createPetContextMenuTemplate({ ...base(), ignoreMouseEvents: true, focusModeEnabled: true, launchAtLogin: true })

    expect(template.map(item => 'label' in item ? item.label : item.type)).toEqual([
      '打开 CppPilot',
      '快速聊天',
      '隐藏桌宠',
      '隐藏一小时',
      '取消定时隐藏',
      '截图提问',
      '专注模式',
      '开机启动',
      '鼠标穿透',
      '设置'
    ])
    expect((template[6] as any).checked).toBe(true)
    expect((template[7] as any).checked).toBe(true)
    expect((template[8] as any).checked).toBe(true)
  })

  it('disables hide-for-one-hour while a timed hide is active and allows cancelling it', () => {
    const template = createPetContextMenuTemplate({ ...base(), hiddenUntil: new Date(Date.now() + 60_000).toISOString() })

    expect((template[3] as any).enabled).toBe(false)
    expect((template[4] as any).enabled).toBe(true)
  })
})