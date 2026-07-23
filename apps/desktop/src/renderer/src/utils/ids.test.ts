import { describe, expect, it } from 'vitest'
import { asOptionalUuid, isUuid } from './ids'

describe('ids', () => {
  it('accepts standard uuid v4 values', () => {
    expect(isUuid('d12f48b1-86f3-4e9e-a83c-106b9f499d7a')).toBe(true)
    expect(asOptionalUuid('d12f48b1-86f3-4e9e-a83c-106b9f499d7a')).toBe('d12f48b1-86f3-4e9e-a83c-106b9f499d7a')
  })

  it('rejects empty and non-uuid project identifiers', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('循环练习')).toBe(false)
    expect(asOptionalUuid('')).toBeUndefined()
    expect(asOptionalUuid(null)).toBeUndefined()
  })
})