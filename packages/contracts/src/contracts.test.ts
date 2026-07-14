import { describe, expect, it } from 'vitest'
import { fileRevisionSchema, projectDraftInputSchema, workspaceSchema } from './index'

describe('contracts', () => {
  it('rejects malformed workspaces', () => {
    expect(workspaceSchema.safeParse({ id: 'bad' }).success).toBe(false)
  })
  it('applies draft defaults', () => {
    const value = projectDraftInputSchema.parse({ mode: 'manual', workspaceId: crypto.randomUUID(), name: 'hello', type: 'single-file' })
    expect(value.samples).toEqual([])
  })
  it('limits editor payload size', () => {
    const value = { projectId: crypto.randomUUID(), relativePath: 'main.cpp', content: 'x'.repeat(2_097_153), expectedHash: '', createSnapshot: true }
    expect(fileRevisionSchema.safeParse(value).success).toBe(false)
  })
})
