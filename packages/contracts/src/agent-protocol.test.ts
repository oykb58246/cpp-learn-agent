import { describe, expect, it } from 'vitest'
import {
  agentFinalRequestSchema,
  agentFinalResponseSchema,
  agentPlanRequestSchema,
  agentPlanResponseSchema
} from './agent-protocol'

const taskId = crypto.randomUUID()
const conversationId = crypto.randomUUID()

describe('unified Agent model protocol', () => {
  it('validates a rich planning envelope with learner, workspace, environment and capabilities', () => {
    const request = agentPlanRequestSchema.parse({
      protocol: 'cpppilot.plan.request.v1',
      taskId,
      conversationId,
      task: { message: '帮我写一个 hello world 程序', source: 'workspace', activeFile: 'main.cpp' },
      learnerState: {
        startingPoint: 'zero-beginner',
        knowledge: [{ conceptId: 'basics.program', status: 'learning', confidence: 0.5 }],
        focusConceptIds: ['basics.program'],
        relevantErrors: [],
        dueReviews: [],
        teachingInstructions: '使用适合初学者的中文解释。'
      },
      workspaceState: {
        project: { id: crypto.randomUUID(), name: 'demo', type: 'single-file' },
        activeFile: { path: 'main.cpp', content: 'int Main() {}', contentHash: 'hash-1', dirty: false },
        relatedFiles: ['README.md'], diagnostics: []
      },
      environmentState: { cppStandard: 'c++17', compiler: 'gcc', cmakeAvailable: true },
      conversationState: { messages: [] },
      capabilities: {
        workflows: ['answer', 'edit-and-build'],
        tools: [{ name: 'workspace.apply_patch', title: '应用补丁', description: '修改项目文件', risk: 'L2', inputSchema: {} }]
      },
      policy: { allowedProjectId: crypto.randomUUID(), allowedPaths: ['main.cpp'], writesRequireApproval: true, maxSteps: 12, maxToolCalls: 20 }
    })

    expect(request.learnerState.knowledge[0]?.status).toBe('learning')
    expect(request.capabilities.tools[0]?.risk).toBe('L2')
  })

  it('validates multi-intent plans and dependency-ordered tool steps', () => {
    const response = agentPlanResponseSchema.parse({
      protocol: 'cpppilot.plan.response.v1', taskId,
      intent: { primary: 'edit_code', secondary: ['explain_code'], confidence: 0.97 },
      needsClarification: false, workflow: 'edit-and-build', contextRequests: [],
      steps: [
        { id: 'patch', title: '写入程序', kind: 'tool', tool: 'workspace.apply_patch', arguments: { relativePath: 'main.cpp', content: 'int main() {}' }, dependsOn: [] },
        { id: 'build', title: '编译验证', kind: 'validate', tool: 'compiler.build', arguments: { relativePath: 'main.cpp' }, dependsOn: ['patch'] }
      ],
      responseGoal: '说明实际修改和编译结果'
    })

    expect(response.intent.secondary).toEqual(['explain_code'])
    expect(response.steps[1]?.dependsOn).toEqual(['patch'])
  })

  it('requires evidence-backed final responses', () => {
    const request = agentFinalRequestSchema.parse({
      protocol: 'cpppilot.final.request.v1', taskId,
      originalTask: '写入 hello world', intent: 'edit_code',
      execution: [{ stepId: 'patch', tool: 'workspace.apply_patch', ok: true, summary: 'main.cpp 已更新', changedFiles: ['main.cpp'] }],
      learnerState: { relevantConceptIds: ['basics.program'], teachingInstructions: '面向初学者解释。' },
      responseGoal: '只陈述证据支持的结果'
    })
    const response = agentFinalResponseSchema.parse({
      protocol: 'cpppilot.final.response.v1', taskId,
      messageMarkdown: '已更新 `main.cpp`。', suggestedConceptIds: ['basics.program'], suggestedNextActions: ['运行程序']
    })

    expect(request.execution[0]?.ok).toBe(true)
    expect(response.messageMarkdown).toContain('main.cpp')
    expect(agentFinalResponseSchema.safeParse({ ...response, messageMarkdown: '' }).success).toBe(false)
  })
})
