export const defaultShortcutAccelerators = {
  openMain: 'CommandOrControl+Alt+C',
  togglePet: 'CommandOrControl+Alt+P',
  captureScreenshot: 'CommandOrControl+Alt+S'
} as const

interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
}

interface ShortcutCallbacks {
  openMain: () => void
  togglePet: () => void
  captureScreenshot: () => void
}

export interface ShortcutRegistrationResult {
  registered: string[]
  failed: string[]
}

export function registerCppPilotShortcuts(registry: ShortcutRegistry, callbacks: ShortcutCallbacks): ShortcutRegistrationResult {
  const entries: Array<[string, () => void]> = [
    [defaultShortcutAccelerators.openMain, callbacks.openMain],
    [defaultShortcutAccelerators.togglePet, callbacks.togglePet],
    [defaultShortcutAccelerators.captureScreenshot, callbacks.captureScreenshot]
  ]
  const registered: string[] = []
  const failed: string[] = []

  for (const [accelerator, callback] of entries) {
    if (registry.register(accelerator, callback)) registered.push(accelerator)
    else failed.push(accelerator)
  }

  return { registered, failed }
}