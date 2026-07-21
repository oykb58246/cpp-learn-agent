import { describe, expect, it } from 'vitest'
import { basename } from 'node:path'
import { resolveTrayIconPath, resolveWindowIconPath, trayIconCandidates } from './app-icons'

const input = { dirname: 'D:/Desktop/cpp-learn-agent/apps/desktop/out/main', resourcesPath: 'C:/Program Files/CppPilot/resources', packaged: true }

describe('app icon paths', () => {
  it('prefers packaged tray PNG resources before dev fallback paths', () => {
    const candidates = trayIconCandidates(input)

    expect(candidates.map(item => item.replaceAll('\\', '/'))[0]).toBe('C:/Program Files/CppPilot/resources/tray-icon.png')
  })

  it('resolves the first existing tray and window icon path', () => {
    const exists = (filePath: string) => basename(filePath) === 'tray-icon.png'

    expect(resolveTrayIconPath({ ...input, exists })?.replaceAll('\\', '/')).toBe('C:/Program Files/CppPilot/resources/tray-icon.png')
    expect(resolveWindowIconPath({ ...input, exists })?.replaceAll('\\', '/')).toBe('C:/Program Files/CppPilot/resources/tray-icon.png')
  })
})



