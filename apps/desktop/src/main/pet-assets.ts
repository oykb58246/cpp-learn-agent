import { basename, extname, join, resolve, sep } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import type { PetCustomAsset, PetCustomAssetMime, PetSettings } from '@cpp-pet/contracts'

export const PET_ASSET_LIMIT_BYTES = 10 * 1024 * 1024
export const PET_ASSET_PROTOCOL = 'cpppilot-pet-asset'
export interface PetAssetImportInput {
  filePath: string
  requestedName: string
  sizeBytes: number
  isFile: boolean
}

export interface PetAssetImportCandidate {
  source: string
  ext: string
  mime: PetCustomAssetMime
  name: string
}

export function validateCustomPetAssetImport(input: PetAssetImportInput): PetAssetImportCandidate {
  const name = input.requestedName.trim()
  if (!name) throw new Error('素材名称不能为空。')
  const ext = petAssetExtensionForPath(input.filePath)
  const mime = petAssetMimeForPath(input.filePath)
  if (!ext || !mime) throw new Error('只支持 PNG、JPG、WEBP 或 GIF 桌宠素材。')
  if (!input.isFile) throw new Error('请选择图片文件。')
  if (input.sizeBytes > PET_ASSET_LIMIT_BYTES) throw new Error('单个桌宠素材不能超过 10 MB。')
  return { source: input.filePath, ext, mime, name }
}
const PET_ASSET_HOST = 'asset'
const PET_ASSET_MIME_BY_EXT: ReadonlyMap<string, PetCustomAssetMime> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
] as const)

export function petAssetMimeForPath(filePath: string): PetCustomAssetMime | undefined {
  return PET_ASSET_MIME_BY_EXT.get(extname(filePath).toLowerCase())
}

export function petAssetExtensionForPath(filePath: string): string | undefined {
  const extension = extname(filePath).toLowerCase()
  return PET_ASSET_MIME_BY_EXT.has(extension) ? extension : undefined
}

export function petActiveCustomAsset(settings: PetSettings): PetCustomAsset | undefined {
  if (settings.assetMode !== 'custom' || !settings.customAssets.length) return undefined
  if (settings.activeCustomAssetId) {
    const active = settings.customAssets.find(item => item.id === settings.activeCustomAssetId)
    if (active) return active
  }
  return settings.customAssets[0]
}

export function petCustomAssetUrl(
  settings: PetSettings,
  managedDirectory: string,
  exists: (filePath: string) => boolean = existsSync
): string | undefined {
  const asset = petActiveCustomAsset(settings)
  if (!asset) return undefined
  if (!isPathInsideDirectory(asset.path, managedDirectory) || !exists(asset.path)) return undefined
  const url = new URL(`${PET_ASSET_PROTOCOL}://${PET_ASSET_HOST}/${encodeURIComponent(basename(asset.path))}`)
  if (asset.updatedAt) url.searchParams.set('v', asset.updatedAt)
  return url.toString()
}

export function petAssetFilePathFromUrl(rawUrl: string, managedDirectory: string): string | undefined {
  if (rawUrl.includes('..') || /%2e/i.test(rawUrl) || /%5c/i.test(rawUrl)) return undefined
  let url: URL
  try { url = new URL(rawUrl) } catch { return undefined }
  if (url.protocol !== `${PET_ASSET_PROTOCOL}:` || url.hostname !== PET_ASSET_HOST) return undefined
  const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (!name || name.includes('/') || name.includes('\\')) return undefined
  const target = join(managedDirectory, name)
  return isPathInsideDirectory(target, managedDirectory) ? target : undefined
}

export function removeManagedPetAsset(
  filePath: string | undefined,
  managedDirectory: string,
  remove: (filePath: string) => void = path => rmSync(path, { force: true })
): void {
  if (!filePath || !isPathInsideDirectory(filePath, managedDirectory)) return
  remove(filePath)
}

function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const root = resolve(directory).toLowerCase()
  const target = resolve(filePath).toLowerCase()
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  return target.startsWith(rootWithSeparator)
}
