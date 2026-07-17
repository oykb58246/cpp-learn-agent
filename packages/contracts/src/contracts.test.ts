import { describe, expect, it } from 'vitest'
import {
  agentRequestSchema,
  buildRequestSchema,
  cmakeBuildRequestSchema,
  ctestRunRequestSchema,
  debugCommandRequestSchema,
  debugStartRequestSchema,
  agentConversationSchema,
  agentMessageSchema,
  conversationMessageDeltaSchema,
  diagnosticIncidentSchema,
  diagnosticOccurrenceSchema,
  environmentInstallRequestSchema,
  environmentInstallTaskSchema,
  environmentInstallerStatusSchema,
  environmentOpenDownloadRequestSchema,
  fileRevisionSchema,
  languageDocumentSyncSchema,
  languagePositionRequestSchema,
  programRunRequestSchema,
  projectDraftInputSchema,
  staticAnalysisRequestSchema,
  toolchainCandidateSchema,
  toolchainProfileSchema,
  vscodeOpenRequestSchema,
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
  it('validates project tooling requests', () => {
    const runId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    expect(cmakeBuildRequestSchema.parse({ runId, projectId })).toMatchObject({ standard: 'c++17', configuration: 'Debug' })
    expect(ctestRunRequestSchema.parse({ runId, buildId: crypto.randomUUID() }).timeoutMs).toBe(30_000)
    expect(staticAnalysisRequestSchema.safeParse({ runId, projectId, relativePath: '../main.cpp' }).success).toBe(true)
    expect(vscodeOpenRequestSchema.safeParse({ projectId, relativePath: 'main.cpp', line: 4, column: 2 }).success).toBe(true)
    expect(vscodeOpenRequestSchema.safeParse({ projectId, line: 0 }).success).toBe(false)
  })
  it('validates language and debugger requests', () => {
    const projectId = crypto.randomUUID()
    expect(languageDocumentSyncSchema.safeParse({ projectId, relativePath: 'main.cpp', content: 'int main() {}', version: 1 }).success).toBe(true)
    expect(languagePositionRequestSchema.safeParse({ projectId, relativePath: 'main.cpp', line: 1, column: 5 }).success).toBe(true)
    expect(debugStartRequestSchema.parse({ projectId, relativePath: 'main.cpp', breakpoints: [{ relativePath: 'main.cpp', line: 2 }] }).standard).toBe('c++17')
    expect(debugCommandRequestSchema.safeParse({ sessionId: crypto.randomUUID(), command: 'next' }).success).toBe(true)
  })
  it('validates diagnostic inbox and streamed conversation contracts', () => {
    const now = new Date().toISOString()
    const occurrence = {
      id: crypto.randomUUID(), groupId: crypto.randomUUID(), file: 'main.cpp', line: 8, column: 5,
      rawMessage: 'expected ; before return', normalizedMessage: 'expected ; before return'
    }
    expect(diagnosticOccurrenceSchema.safeParse(occurrence).success).toBe(true)
    expect(diagnosticIncidentSchema.safeParse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), attemptId: crypto.randomUUID(),
      targetKey: 'main.cpp:c++17', operation: 'build', failureKinds: ['compile'], status: 'active',
      acknowledgedAt: undefined, createdAt: now, updatedAt: now,
      groups: [{
        id: crypto.randomUUID(), incidentId: crypto.randomUUID(), fingerprint: 'fingerprint', source: 'compiler',
        failureKind: 'compile', severity: 'error', title: '语句结束符缺失', normalizedTemplate: 'expected ;',
        occurrenceCount: 1, createdAt: now, occurrences: [occurrence]
      }]
    }).success).toBe(true)
    expect(agentConversationSchema.safeParse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), title: '新对话', status: 'active', createdAt: now, updatedAt: now
    }).success).toBe(true)
    expect(agentMessageSchema.safeParse({
      id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'assistant', kind: 'text',
      content: '你好', status: 'streaming', createdAt: now, updatedAt: now
    }).success).toBe(true)
    expect(conversationMessageDeltaSchema.safeParse({
      projectId: crypto.randomUUID(), conversationId: crypto.randomUUID(), messageId: crypto.randomUUID(), sequence: 0, delta: '你好'
    }).success).toBe(true)
  })
  it('rejects unsafe diagnostic and malformed message payloads', () => {
    expect(diagnosticOccurrenceSchema.safeParse({
      id: crypto.randomUUID(), groupId: crypto.randomUUID(), file: 'C:\\workspace\\main.cpp', line: 1,
      rawMessage: 'x', normalizedMessage: 'x'
    }).success).toBe(false)
    expect(agentMessageSchema.safeParse({
      id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'user', kind: 'text',
      content: '', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }).success).toBe(false)
    expect(agentMessageSchema.safeParse({
      id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'assistant', kind: 'text',
      content: '', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }).success).toBe(true)
    expect(conversationMessageDeltaSchema.safeParse({
      projectId: crypto.randomUUID(), conversationId: crypto.randomUUID(), messageId: crypto.randomUUID(), sequence: -1, delta: 'x'
    }).success).toBe(false)
  })
  it('restricts environment downloads to known official targets', () => {
    expect(environmentOpenDownloadRequestSchema.safeParse({ target: 'msys2' }).success).toBe(true)
    expect(environmentOpenDownloadRequestSchema.safeParse({ target: 'https://example.com' }).success).toBe(false)
    expect(environmentInstallRequestSchema.safeParse({ target: 'llvm' }).success).toBe(true)
    expect(environmentInstallRequestSchema.safeParse({ target: 'visual-studio' }).success).toBe(false)
    expect(environmentInstallerStatusSchema.safeParse({ available: true, manager: 'winget', version: 'v1' }).success).toBe(true)
    expect(environmentInstallTaskSchema.safeParse({
      taskId: crypto.randomUUID(),
      target: 'cmake',
      packageId: 'Kitware.CMake',
      status: 'succeeded',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0
    }).success).toBe(true)
  })
})
