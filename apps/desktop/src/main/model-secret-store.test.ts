import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelSecretStore } from './model-secret-store'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('ModelSecretStore', () => {
  it('persists only protected API key bytes and supports clearing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpppilot-secrets-'))
    dirs.push(dir)
    const file = join(dir, 'model-secrets.json')
    const protector = {
      encryptString(value: string) { return Buffer.from(`protected:${Buffer.from(value).toString('base64')}`) },
      decryptString(value: Buffer) { return Buffer.from(value.toString().replace('protected:', ''), 'base64').toString() }
    }
    const store = new ModelSecretStore(file, protector)

    store.set('profile-1', 'sk-local-secret')

    expect(readFileSync(file, 'utf8')).not.toContain('sk-local-secret')
    expect(store.has('profile-1')).toBe(true)
    expect(store.get('profile-1')).toBe('sk-local-secret')
    store.clear('profile-1')
    expect(store.has('profile-1')).toBe(false)
  })
})
