import type { MessageBoxOptions } from 'electron'

export type MainWindowCloseAction = 'minimize-to-pet' | 'quit' | 'cancel'

export function createMainWindowCloseDialogOptions(): MessageBoxOptions {
  return {
    type: 'question',
    title: '关闭 CppPilot',
    message: '要最小化到桌宠，还是直接退出 CppPilot？',
    detail: '最小化后可以单击桌宠重新打开主窗口，也可以右键桌宠退出应用。',
    buttons: ['最小化到桌宠', '退出 CppPilot', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  }
}

export function mainWindowCloseAction(response: number): MainWindowCloseAction {
  if (response === 0) return 'minimize-to-pet'
  if (response === 1) return 'quit'
  return 'cancel'
}
