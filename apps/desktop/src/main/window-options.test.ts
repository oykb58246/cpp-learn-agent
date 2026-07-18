import { describe, expect, it } from 'vitest'
import { createWindowOptions } from './window-options'

describe('createWindowOptions', () => {
  it('omits the icon property when the icon does not exist', () => {
    const options = createWindowOptions({
      iconPath: 'missing.ico',
      iconExists: false,
      titleBarColor: '#ffffff',
      symbolColor: '#111111',
      backgroundColor: '#ffffff',
      preloadPath: 'preload.cjs'
    })

    expect('icon' in options).toBe(false)
  })

  it('includes the icon path when the icon exists', () => {
    const options = createWindowOptions({
      iconPath: 'cpppilot.ico',
      iconExists: true,
      titleBarColor: '#ffffff',
      symbolColor: '#111111',
      backgroundColor: '#ffffff',
      preloadPath: 'preload.cjs'
    })

    expect(options.icon).toBe('cpppilot.ico')
  })
})
