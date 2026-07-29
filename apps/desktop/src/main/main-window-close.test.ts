import { describe, expect, it } from 'vitest'
import { createMainWindowCloseDialogOptions, mainWindowCloseAction } from './main-window-close'

describe('main window close behavior', () => {
  it('offers minimize, quit and cancel choices', () => {
    expect(createMainWindowCloseDialogOptions()).toMatchObject({
      buttons: ['最小化到桌宠', '退出 CppPilot', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
  })

  it('maps native dialog responses to lifecycle actions', () => {
    expect(mainWindowCloseAction(0)).toBe('minimize-to-pet')
    expect(mainWindowCloseAction(1)).toBe('quit')
    expect(mainWindowCloseAction(2)).toBe('cancel')
    expect(mainWindowCloseAction(-1)).toBe('cancel')
  })
})
