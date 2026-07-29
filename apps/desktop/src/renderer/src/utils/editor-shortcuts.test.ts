import { describe, expect, it } from 'vitest'
import { matchingWorkspaceShortcut, workspaceShortcutLabel } from './editor-shortcuts'

function key(key: string, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }
}

describe('editor shortcuts', () => {
  it('matches build and CMake build without confusing their modifiers', () => {
    expect(matchingWorkspaceShortcut(key('b', { ctrlKey: true, shiftKey: true }))).toBe('compile')
    expect(matchingWorkspaceShortcut(key('B', { ctrlKey: true, altKey: true }))).toBe('cmake-build')
    expect(matchingWorkspaceShortcut(key('b', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeUndefined()
  })

  it('distinguishes run, debug and stop commands on F5', () => {
    expect(matchingWorkspaceShortcut(key('F5'))).toBe('debug')
    expect(matchingWorkspaceShortcut(key('F5', { ctrlKey: true }))).toBe('run')
    expect(matchingWorkspaceShortcut(key('F5', { ctrlKey: true, altKey: true }))).toBe('cmake-run')
    expect(matchingWorkspaceShortcut(key('F5', { shiftKey: true }))).toBe('stop')
  })

  it('supports Command as the primary modifier and exposes display labels', () => {
    expect(matchingWorkspaceShortcut(key('s', { metaKey: true }))).toBe('save')
    expect(workspaceShortcutLabel('debug-step-out')).toBe('Shift+F11')
  })
})
