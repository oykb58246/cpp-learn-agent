export type WorkspaceShortcutCommand =
  | 'save'
  | 'compile'
  | 'run'
  | 'stop'
  | 'cmake-build'
  | 'cmake-run'
  | 'ctest'
  | 'analysis'
  | 'ask-ai'
  | 'vscode'
  | 'debug'
  | 'debug-next'
  | 'debug-step-in'
  | 'debug-step-out'

interface ShortcutDefinition {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  label: string
}

export const workspaceShortcuts: Record<WorkspaceShortcutCommand, ShortcutDefinition> = {
  save: { key: 's', ctrl: true, label: 'Ctrl+S' },
  compile: { key: 'b', ctrl: true, shift: true, label: 'Ctrl+Shift+B' },
  run: { key: 'F5', ctrl: true, label: 'Ctrl+F5' },
  stop: { key: 'F5', shift: true, label: 'Shift+F5' },
  'cmake-build': { key: 'b', ctrl: true, alt: true, label: 'Ctrl+Alt+B' },
  'cmake-run': { key: 'F5', ctrl: true, alt: true, label: 'Ctrl+Alt+F5' },
  ctest: { key: 't', ctrl: true, alt: true, label: 'Ctrl+Alt+T' },
  analysis: { key: 'a', ctrl: true, alt: true, label: 'Ctrl+Alt+A' },
  'ask-ai': { key: 'i', ctrl: true, alt: true, label: 'Ctrl+Alt+I' },
  vscode: { key: 'o', ctrl: true, alt: true, label: 'Ctrl+Alt+O' },
  debug: { key: 'F5', label: 'F5' },
  'debug-next': { key: 'F10', label: 'F10' },
  'debug-step-in': { key: 'F11', label: 'F11' },
  'debug-step-out': { key: 'F11', shift: true, label: 'Shift+F11' }
}

export function workspaceShortcutLabel(command: WorkspaceShortcutCommand): string {
  return workspaceShortcuts[command].label
}

export function matchingWorkspaceShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): WorkspaceShortcutCommand | undefined {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const ctrl = event.ctrlKey || event.metaKey
  return (Object.entries(workspaceShortcuts) as Array<[WorkspaceShortcutCommand, ShortcutDefinition]>)
    .find(([, shortcut]) => (
      shortcut.key.toLowerCase() === key.toLowerCase()
      && Boolean(shortcut.ctrl) === ctrl
      && Boolean(shortcut.alt) === event.altKey
      && Boolean(shortcut.shift) === event.shiftKey
    ))?.[0]
}
