import type { BrowserWindowConstructorOptions } from 'electron'

interface WindowOptionsInput {
  iconPath: string
  iconExists: boolean
  titleBarColor: string
  symbolColor: string
  backgroundColor: string
  preloadPath: string
}

export function createWindowOptions(input: WindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: 'CppPilot：带桌面宠物的 C++ 学习 Agent',
    ...(input.iconExists ? { icon: input.iconPath } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: input.titleBarColor,
      symbolColor: input.symbolColor,
      height: 48
    },
    backgroundColor: input.backgroundColor,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  }
}
