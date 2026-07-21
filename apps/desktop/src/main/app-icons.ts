import { join } from 'node:path'

interface AppIconPathInput {
  dirname: string
  resourcesPath: string
  packaged: boolean
  exists: (filePath: string) => boolean
}

export function trayIconCandidates(input: Omit<AppIconPathInput, 'exists'>): string[] {
  const devBuild = join(input.dirname, '../../build')
  const packaged = [
    join(input.resourcesPath, 'tray-icon.png'),
    join(input.resourcesPath, 'app-icon.ico'),
    join(input.resourcesPath, 'build', 'icon.png'),
    join(input.resourcesPath, 'build', 'icon.ico')
  ]
  const dev = [join(devBuild, 'icon.png'), join(devBuild, 'icon.ico')]
  return input.packaged ? [...packaged, ...dev] : [...dev, ...packaged]
}

export function windowIconCandidates(input: Omit<AppIconPathInput, 'exists'>): string[] {
  const devBuild = join(input.dirname, '../../build')
  const packaged = [
    join(input.resourcesPath, 'app-icon.ico'),
    join(input.resourcesPath, 'tray-icon.png'),
    join(input.resourcesPath, 'build', 'icon.ico'),
    join(input.resourcesPath, 'build', 'icon.png')
  ]
  const dev = [join(devBuild, 'icon.ico'), join(devBuild, 'icon.png')]
  return input.packaged ? [...packaged, ...dev] : [...dev, ...packaged]
}

export function resolveTrayIconPath(input: AppIconPathInput): string | undefined {
  return trayIconCandidates(input).find(input.exists)
}

export function resolveWindowIconPath(input: AppIconPathInput): string | undefined {
  return windowIconCandidates(input).find(input.exists)
}
