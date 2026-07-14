import { describe, expect, it } from 'vitest'
import {
  agentRequestSchema,
  buildRequestSchema,
  fileRevisionSchema,
  programRunRequestSchema,
  projectDraftInputSchema,
  toolchainCandidateSchema,
  toolchainProfileSchema,
  workspaceSchema
} from './index'

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
  it('reserves validated contracts for later stages', () => {
    expect(agentRequestSchema.safeParse({ requestId: crypto.randomUUID(), source: 'editor', mode: 'diagnose', message: '解释错误' }).success).toBe(true)
    expect(toolchainProfileSchema.safeParse({ id: crypto.randomUUID(), family: 'gcc', version: '14', targetArch: 'x64', compilerPath: 'C:/mingw/bin/g++.exe', capabilities: { compile: true, debug: false, compileDatabase: true }, verifiedAt: new Date().toISOString() }).success).toBe(true)
    expect(toolchainCandidateSchema.safeParse({ id: 'gcc:test', family: 'gcc', version: '14', targetArch: 'x64', compilerPath: 'C:/mingw/bin/g++.exe', source: 'path', capabilities: { compile: true, debug: true, compileDatabase: true } }).success).toBe(true)
  })
  it('validates bounded build and run requests', () => {
    const runId = crypto.randomUUID()
    expect(buildRequestSchema.parse({ runId, projectId: crypto.randomUUID(), relativePath: 'main.cpp' }).standard).toBe('c++17')
    expect(programRunRequestSchema.parse({ runId, buildId: crypto.randomUUID() }).timeoutMs).toBe(5_000)
    expect(programRunRequestSchema.safeParse({ runId, buildId: crypto.randomUUID(), input: 'x'.repeat(65_537) }).success).toBe(false)
  })
})
