import { describe, expect, it } from 'vitest'
import {
  agentRequestSchema,
  buildRequestSchema,
  cmakeBuildRequestSchema,
  cmakeExecutableTargetSchema,
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
  petChatRequestSchema,
  petCustomAssetCreateInputSchema,
  petDragWindowRequestSchema,
  petSettingsSchema,
  petSettingsPatchSchema,
  petWindowStateSchema,
  practiceCatalogSchema,
  practiceExerciseSchema,
  practiceOjImportInputSchema,
  practiceOjImportResultSchema,
  practiceOjScreenshotInputSchema,
  practiceOjTextInputSchema,
  programRunRequestSchema,
  projectDraftInputSchema,
  screenshotCaptureRequestSchema,
  screenshotCaptureSubmissionSchema,
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
    expect(cmakeExecutableTargetSchema.safeParse({ name: 'cpppilot_demo', buildId: crypto.randomUUID() }).success).toBe(true)
    expect(cmakeExecutableTargetSchema.safeParse({ name: '', buildId: 'invalid' }).success).toBe(false)
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
    expect(agentMessageSchema.safeParse({
      id: crypto.randomUUID(), conversationId: crypto.randomUUID(), role: 'user', kind: 'screenshot-question',
      content: '解释这张截图', status: 'completed', createdAt: now, updatedAt: now, completedAt: now,
      screenshot: {
        id: crypto.randomUUID(), previewDataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
        width: 320, height: 180, createdAt: now
      }
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
  it('validates H4 pet settings and screenshot request contracts', () => {
    const settings = petSettingsSchema.parse({})
    expect(settings).toMatchObject({
      visible: true,
      assetMode: 'cpppilot-logo',
      scale: 1,
      ignoreMouseEvents: false,
      bubbleEnabled: true,
      customAssets: []
    })
    expect(petSettingsSchema.safeParse({ assetMode: 'cat' }).success).toBe(false)
    expect(petSettingsSchema.parse({ assetMode: 'cpppilot-cursor' }).assetMode).toBe('cpppilot-logo')
    expect(petSettingsSchema.parse({ assetMode: 'cpppilot-mascot' }).assetMode).toBe('cpppilot-logo')
    expect(petSettingsSchema.safeParse({ scale: 0.2 }).success).toBe(false)
    const customAsset = {
      id: 'asset-1', name: '猫猫', path: 'C:/Users/me/AppData/Roaming/CppPilot/pet-assets/cat.gif',
      mime: 'image/gif' as const, updatedAt: new Date().toISOString()
    }
    expect(petSettingsSchema.safeParse({ assetMode: 'custom', customAssets: [customAsset], activeCustomAssetId: customAsset.id }).success).toBe(true)
    expect(petSettingsSchema.parse({
      assetMode: 'custom', customAssetPath: customAsset.path,
      customAssetName: 'cat.gif', customAssetMime: 'image/gif', customAssetUpdatedAt: customAsset.updatedAt
    })).toMatchObject({ assetMode: 'custom', customAssets: [expect.objectContaining({ name: 'cat.gif', mime: 'image/gif' })] })
    expect(petSettingsSchema.safeParse({ assetMode: 'custom', customAssets: [{ ...customAsset, mime: 'image/svg+xml' }] }).success).toBe(false)
    expect(petWindowStateSchema.safeParse({
      settings, windowVisible: true, ignoreMouseEvents: false, growthStage: 2,
      progress: { stage: 2, totalStages: 4, percent: 50, label: '通关进度 2/4' }
    }).success).toBe(true)
    expect(petDragWindowRequestSchema.safeParse({
      initialBounds: { x: 10, y: 20, width: 220, height: 260 },
      pointerStartScreenX: 20, pointerStartScreenY: 30, pointerCurrentScreenX: 100, pointerCurrentScreenY: 120
    }).success).toBe(true)
    expect(petChatRequestSchema.safeParse({ message: '解释一下循环' }).success).toBe(true)
    expect(petChatRequestSchema.safeParse({ message: '   ' }).success).toBe(false)
    const conversationId = crypto.randomUUID()
    expect(screenshotCaptureRequestSchema.safeParse({ message: '解释这张截图', projectId: crypto.randomUUID(), conversationId }).success).toBe(true)
    expect(screenshotCaptureSubmissionSchema.safeParse({
      message: '解释这张截图', previewDataUrl: 'data:image/png;base64,AAAA', width: 320, height: 180,
      projectId: crypto.randomUUID(), conversationId
    }).success).toBe(true)
    expect(screenshotCaptureRequestSchema.safeParse({ message: '' }).success).toBe(false)
  })

  it('keeps pet settings patches truly partial without filling defaults', () => {
    const frameOnly = petSettingsPatchSchema.parse({ frameEnabled: false })
    expect(frameOnly).toEqual({ frameEnabled: false })
    expect(Object.keys(frameOnly)).toEqual(['frameEnabled'])

    const progressOnly = petSettingsPatchSchema.parse({ progressBarEnabled: false })
    expect(progressOnly).toEqual({ progressBarEnabled: false })

    const assetOnly = petSettingsPatchSchema.parse({ assetMode: 'salary-cat' })
    expect(assetOnly).toEqual({ assetMode: 'salary-cat' })
    expect(Object.prototype.hasOwnProperty.call(assetOnly, 'customAssets')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(assetOnly, 'scale')).toBe(false)

    const empty = petSettingsPatchSchema.parse({})
    expect(empty).toEqual({})

    const multi = petSettingsPatchSchema.parse({
      bubbleEnabled: false,
      frameEnabled: true,
      progressBarEnabled: false
    })
    expect(multi).toEqual({
      bubbleEnabled: false,
      frameEnabled: true,
      progressBarEnabled: false
    })
  })
  it('validates practice catalog and OJ screenshot import contracts', () => {
    const now = new Date().toISOString()
    const exercise = {
      id: 'loops-sum-1', title: '区间求和', knowledgePoint: '循环', conceptIds: ['control.loops'], difficulty: 2,
      statement: '输入 n，输出 1 到 n 的和。', constraints: ['1 <= n <= 1000'],
      samples: [{ input: '3', output: '6' }], source: 'built-in' as const, createdAt: now, updatedAt: now
    }
    const project = {
      id: 'project-gradebook', title: '成绩统计器', knowledgePoint: '数组与函数', conceptIds: ['arrays.basic'], difficulty: 3,
      description: '实现一个读取多人成绩并输出统计信息的小项目。', goals: ['读取输入', '计算平均值'], suggestedFiles: ['main.cpp']
    }

    expect(practiceCatalogSchema.safeParse({ exercises: [exercise], projects: [project] }).success).toBe(true)
    expect(practiceExerciseSchema.safeParse({ ...exercise, conceptIds: [] }).success).toBe(false)
    expect(practiceOjScreenshotInputSchema.safeParse({ previewDataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', width: 320, height: 200 }).success).toBe(true)
    expect(practiceOjScreenshotInputSchema.safeParse({ previewDataUrl: 'hello', mimeType: 'image/png', width: 320, height: 200 }).success).toBe(false)
    const markdownInput = {
      kind: 'text' as const,
      fileName: 'two-sum.md',
      mimeType: 'text/markdown' as const,
      content: '# 两数之和\n\n输入两个整数，输出它们的和。'
    }
    expect(practiceOjTextInputSchema.safeParse(markdownInput).success).toBe(true)
    expect(practiceOjImportInputSchema.safeParse(markdownInput).success).toBe(true)
    expect(practiceOjImportInputSchema.safeParse({ ...markdownInput, mimeType: 'text/html' }).success).toBe(false)
    expect(practiceOjTextInputSchema.safeParse({ ...markdownInput, content: 'x'.repeat(1_000_001) }).success).toBe(false)
    expect(practiceOjImportResultSchema.safeParse({ status: 'added', exercise }).success).toBe(true)
    expect(practiceOjImportResultSchema.safeParse({ status: 'refused', reason: '截图缺少完整题面和样例。' }).success).toBe(true)
    expect(practiceOjImportResultSchema.safeParse({ status: 'added' }).success).toBe(false)
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
