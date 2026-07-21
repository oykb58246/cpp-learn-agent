import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows managed desktop pet assets to render as images', () => {
    const htmlPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
    const html = readFileSync(htmlPath, 'utf8')

    expect(html).toContain('img-src')
    expect(html).toContain('cpppilot-pet-asset:')
  })
})
