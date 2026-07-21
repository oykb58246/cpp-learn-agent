import { describe, expect, it, vi } from 'vitest'
import { defaultShortcutAccelerators, registerCppPilotShortcuts } from './shortcuts'

describe('CppPilot global shortcuts', () => {
  it('reports accelerator conflicts instead of silently ignoring failed registrations', () => {
    const register = vi.fn((accelerator: string) => accelerator !== defaultShortcutAccelerators.captureScreenshot)
    const result = registerCppPilotShortcuts({ register } as any, {
      openMain: vi.fn(),
      togglePet: vi.fn(),
      captureScreenshot: vi.fn()
    })

    expect(result.registered).toEqual([defaultShortcutAccelerators.openMain, defaultShortcutAccelerators.togglePet])
    expect(result.failed).toEqual([defaultShortcutAccelerators.captureScreenshot])
  })
})