import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SecretProtector {
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
export class ModelSecretStore {
  constructor(private readonly filePath: string, private readonly protector: SecretProtector) {}

  has(profileId: string): boolean { return Boolean(this.read()[profileId]) }

  get(profileId: string): string | undefined {
    const encrypted = this.read()[profileId]
    if (!encrypted) return undefined
    return this.protector.decryptString(Buffer.from(encrypted, 'base64'))
  }

  set(profileId: string, apiKey: string): void {
    const secrets = this.read()
    secrets[profileId] = this.protector.encryptString(apiKey).toString('base64')
    this.write(secrets)
  }

  clear(profileId: string): void {
    const secrets = this.read()
    delete secrets[profileId]
    this.write(secrets)
  }

  private read(): Record<string, string> {
    if (!existsSync(this.filePath)) return {}
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  private write(value: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, this.filePath)
  }
}
