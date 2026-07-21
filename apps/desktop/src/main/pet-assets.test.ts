import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  petActiveCustomAsset,
  petAssetFilePathFromUrl,
  petAssetMimeForPath,
  petCustomAssetUrl,
  removeManagedPetAsset,
  validateCustomPetAssetImport
} from './pet-assets'
import type { PetCustomAsset, PetSettings } from '@cpp-pet/contracts'

const directory = 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets'
const baseSettings = {
  visible: true,
  assetMode: 'custom',
  scale: 1,
  ignoreMouseEvents: false,
  bubbleEnabled: true,
  focusModeEnabled: false,
  launchAtLogin: false
} as const
const asset = (id: string, name: string, fileName: string, updatedAt = '2026-07-20T10:00:00.000Z'): PetCustomAsset => ({
  id,
  name,
  path: join(directory, fileName),
  mime: fileName.endsWith('.gif') ? 'image/gif' : 'image/png',
  updatedAt
})

describe('pet custom assets', () => {
  it('allows only image and GIF extensions used by the importer', () => {
    expect(petAssetMimeForPath('cat.PNG')).toBe('image/png')
    expect(petAssetMimeForPath('cat.jpeg')).toBe('image/jpeg')
    expect(petAssetMimeForPath('cat.webp')).toBe('image/webp')
    expect(petAssetMimeForPath('cat.gif')).toBe('image/gif')
    expect(petAssetMimeForPath('cat.svg')).toBeUndefined()
  })

  it('validates a single named custom asset import candidate', () => {
    const file = join(directory, 'source-cat.GIF')
    const candidate = validateCustomPetAssetImport({ filePath: file, requestedName: '  课堂猫  ', sizeBytes: 1024, isFile: true })

    expect(candidate).toEqual({ source: file, ext: '.gif', mime: 'image/gif', name: '课堂猫' })
    expect(() => validateCustomPetAssetImport({ filePath: file, requestedName: '   ', sizeBytes: 1024, isFile: true })).toThrow('素材名称不能为空')
    expect(() => validateCustomPetAssetImport({ filePath: join(directory, 'bad.svg'), requestedName: 'SVG', sizeBytes: 1024, isFile: true })).toThrow('只支持 PNG、JPG、WEBP 或 GIF')
    expect(() => validateCustomPetAssetImport({ filePath: file, requestedName: '太大', sizeBytes: 10 * 1024 * 1024 + 1, isFile: true })).toThrow('不能超过 10 MB')
  })

  it('exposes the active managed custom asset through the app protocol only', () => {
    const first = asset('first', '第一只', 'pet-first.png')
    const second = asset('second', '第二只', 'pet-second.gif')
    const settings: PetSettings = { ...baseSettings, assetMode: 'custom', customAssets: [first, second], activeCustomAssetId: second.id }
    const url = petCustomAssetUrl(settings, directory, () => true)

    expect(petActiveCustomAsset(settings)).toEqual(second)
    expect(url).toBe('cpppilot-pet-asset://asset/pet-second.gif?v=2026-07-20T10%3A00%3A00.000Z')
    expect(petAssetFilePathFromUrl(url!, directory)).toBe(join(directory, 'pet-second.gif'))
  })

  it('falls back to the first stored asset when the active id is missing', () => {
    const first = asset('first', '第一只', 'pet-first.png')
    const second = asset('second', '第二只', 'pet-second.gif')
    const settings: PetSettings = { ...baseSettings, assetMode: 'custom', customAssets: [first, second], activeCustomAssetId: 'missing' }

    expect(petActiveCustomAsset(settings)).toEqual(first)
  })

  it('refuses non-custom, missing, and outside-directory custom assets', () => {
    const first = asset('first', '第一只', 'pet-first.png')
    expect(petCustomAssetUrl({ ...baseSettings, assetMode: 'salary-cat', customAssets: [first] }, directory, () => true)).toBeUndefined()
    expect(petCustomAssetUrl({ ...baseSettings, assetMode: 'custom', customAssets: [first] }, directory, () => false)).toBeUndefined()
    expect(petCustomAssetUrl({ ...baseSettings, assetMode: 'custom', customAssets: [{ ...first, path: 'C:/Users/me/Desktop/secret.gif' }] }, directory, () => true)).toBeUndefined()
  })

  it('maps only simple protocol file names back into the managed directory', () => {
    expect(petAssetFilePathFromUrl('file:///C:/Users/me/Desktop/secret.gif', directory)).toBeUndefined()
    expect(petAssetFilePathFromUrl('cpppilot-pet-asset://other/pet.gif', directory)).toBeUndefined()
    expect(petAssetFilePathFromUrl('cpppilot-pet-asset://asset/../secret.gif', directory)).toBeUndefined()
    expect(petAssetFilePathFromUrl('cpppilot-pet-asset://asset/pet-123.gif', directory)).toBe(join(directory, 'pet-123.gif'))
  })

  it('removes only files inside the managed directory', () => {
    const removed: string[] = []
    removeManagedPetAsset(join(directory, 'pet-123.gif'), directory, path => removed.push(path))
    removeManagedPetAsset('C:/Users/me/Desktop/secret.gif', directory, path => removed.push(path))

    expect(removed).toEqual([join(directory, 'pet-123.gif')])
  })
})
