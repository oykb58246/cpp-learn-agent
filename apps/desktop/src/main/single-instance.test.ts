import { describe, expect, it, vi } from 'vitest'
import { configureSingleInstance } from './single-instance'

describe('desktop single-instance ownership', () => {
  it('quits immediately when another instance owns the application lock', () => {
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn()
    }

    expect(configureSingleInstance(app, vi.fn())).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('focuses the existing window when a second instance starts', () => {
    let secondInstance: (() => void) | undefined
    const focus = vi.fn()
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => { secondInstance = listener })
    }

    expect(configureSingleInstance(app, focus)).toBe(true)
    secondInstance?.()
    expect(focus).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
  })
})
