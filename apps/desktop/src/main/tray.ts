import type { MenuItemConstructorOptions } from 'electron'

interface PetMenuInput {
  petVisible: boolean
  ignoreMouseEvents: boolean
  focusModeEnabled: boolean
  launchAtLogin: boolean
  hiddenUntil?: string
  onOpenMain: () => void
  onOpenWorkspace: () => void
  onOpenPractice: () => void
  onOpenKnowledge: () => void
  onOpenRuns: () => void
  onOpenSettings: () => void
  onTogglePet: () => void
  onCaptureScreenshot: () => void
  onQuickChat: () => void
  onHideForOneHour: () => void
  onCancelHidden: () => void
  onToggleFocusMode: (enabled: boolean) => void
  onToggleLaunchAtLogin: (enabled: boolean) => void
  onToggleMouseEvents: (enabled: boolean) => void
  onQuit: () => void
}

export function createPetContextMenuTemplate(input: PetMenuInput): MenuItemConstructorOptions[] {
  return createBasePetMenuTemplate(input)
}

export function createPetTrayMenuTemplate(input: PetMenuInput): MenuItemConstructorOptions[] {
  return createBasePetMenuTemplate(input)
}

function createBasePetMenuTemplate(input: PetMenuInput): MenuItemConstructorOptions[] {
  const hiddenActive = Boolean(input.hiddenUntil && Date.parse(input.hiddenUntil) > Date.now())
  return [
    { label: '打开 CppPilot', click: input.onOpenMain },
    { label: '快速聊天', click: input.onQuickChat },
    {
      label: '学习快捷入口',
      submenu: [
        { label: '打开工作区', click: input.onOpenWorkspace },
        { label: '打开练习', click: input.onOpenPractice },
        { label: '打开知识树', click: input.onOpenKnowledge },
        { label: '查看助教记录', click: input.onOpenRuns },
        { type: 'separator' },
        { label: '截图提问', click: input.onCaptureScreenshot }
      ]
    },
    { type: 'separator' },
    { label: input.petVisible ? '隐藏桌宠' : '显示桌宠', click: input.onTogglePet },
    { label: '隐藏一小时', enabled: !hiddenActive, click: input.onHideForOneHour },
    { label: '取消定时隐藏', enabled: hiddenActive, click: input.onCancelHidden },
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
    { type: 'separator' },
    { label: '设置', click: input.onOpenSettings },
    { label: '退出 CppPilot', click: input.onQuit }
  ]
}
