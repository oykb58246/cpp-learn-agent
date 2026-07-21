import type { MenuItemConstructorOptions } from 'electron'

interface PetMenuInput {
  petVisible: boolean
  ignoreMouseEvents: boolean
  focusModeEnabled: boolean
  launchAtLogin: boolean
  hiddenUntil?: string
  onOpenMain: () => void
  onOpenSettings: () => void
  onTogglePet: () => void
  onCaptureScreenshot: () => void
  onQuickChat: () => void
  onHideForOneHour: () => void
  onCancelHidden: () => void
  onToggleFocusMode: (enabled: boolean) => void
  onToggleLaunchAtLogin: (enabled: boolean) => void
  onToggleMouseEvents: (enabled: boolean) => void
}

interface PetTrayMenuInput extends PetMenuInput {
  onQuit: () => void
}

export function createPetContextMenuTemplate(input: PetMenuInput): MenuItemConstructorOptions[] {
  return createBasePetMenuTemplate(input)
}

export function createPetTrayMenuTemplate(input: PetTrayMenuInput): MenuItemConstructorOptions[] {
  return [
    ...createBasePetMenuTemplate(input),
    { type: 'separator' },
    { label: '退出', click: input.onQuit }
  ]
}

function createBasePetMenuTemplate(input: PetMenuInput): MenuItemConstructorOptions[] {
  const hiddenActive = Boolean(input.hiddenUntil && Date.parse(input.hiddenUntil) > Date.now())
  return [
    { label: '打开 CppPilot', click: input.onOpenMain },
    { label: '快速聊天', click: input.onQuickChat },
    { label: input.petVisible ? '隐藏桌宠' : '显示桌宠', click: input.onTogglePet },
    { label: '隐藏一小时', enabled: !hiddenActive, click: input.onHideForOneHour },
    { label: '取消定时隐藏', enabled: hiddenActive, click: input.onCancelHidden },
    { label: '截图提问', click: input.onCaptureScreenshot },
    {
      label: '专注模式',
      type: 'checkbox',
      checked: input.focusModeEnabled,
      click: item => input.onToggleFocusMode(item.checked)
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: input.launchAtLogin,
      click: item => input.onToggleLaunchAtLogin(item.checked)
    },
    {
      label: '鼠标穿透',
      type: 'checkbox',
      checked: input.ignoreMouseEvents,
      click: item => input.onToggleMouseEvents(item.checked)
    },
    { label: '设置', click: input.onOpenSettings }
  ]
}