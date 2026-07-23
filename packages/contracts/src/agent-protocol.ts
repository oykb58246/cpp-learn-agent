import { z } from 'zod'
import { jsonValueSchema, toolRiskSchema } from './agent'
import { backgroundStartingPointSchema, knowledgeStatusSchema } from './learning'

export const agentIntentSchema = z.enum([
  'answer',
  'explain_code',
  'diagnose_error',
  'edit_code',
  'review_code',
  'create_project',
  'environment_setup'
])
export type AgentIntent = z.infer<typeof agentIntentSchema>

export const agentWorkflowSchema = z.enum([
  'answer',
  'explain-code',
  'diagnose-and-fix',
  'edit-and-build',
  'review-code',
  'create-project',
  'environment-setup'
])
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>

const protocolDiagnosticSchema = z.object({
  source: z.string().min(1).max(100),
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string().max(200).optional(),
  file: z.string().max(1_024).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  message: z.string().min(1).max(20_000)
})

const protocolKnowledgeStateSchema = z.object({
  conceptId: z.string().min(1).max(100),
  status: knowledgeStatusSchema,
  confidence: z.number().min(0).max(1)
})

const protocolToolSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  risk: toolRiskSchema,
  inputSchema: z.record(z.string(), jsonValueSchema)
})

export const agentPlanRequestSchema = z.object({
  protocol: z.literal('cpppilot.plan.request.v1'),
  taskId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  task: z.object({
    message: z.string().trim().min(1).max(20_000),
    source: z.enum(['main', 'workspace', 'pet', 'screenshot', 'system']),
    activeFile: z.string().max(1_024).optional(),
    selection: z.object({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      content: z.string().max(100_000)
    }).optional()
  }),
  learnerState: z.object({
    startingPoint: backgroundStartingPointSchema,
    knowledge: z.array(protocolKnowledgeStateSchema).max(200),
    focusConceptIds: z.array(z.string().min(1).max(100)).max(100),
    relevantErrors: z.array(z.object({
      category: z.string().min(1).max(100),
      title: z.string().min(1).max(500),
      conceptIds: z.array(z.string().min(1).max(100)).max(100),
      status: z.string().min(1).max(100)
    })).max(50),
    dueReviews: z.array(z.object({
      conceptId: z.string().min(1).max(100),
      dueAt: z.string().datetime()
    })).max(50),
    teachingInstructions: z.string().min(1).max(5_000)
  }),
  workspaceState: z.object({
    project: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200),
      type: z.enum(['single-file', 'multi-file', 'cmake'])
    }).optional(),
    activeFile: z.object({
      path: z.string().min(1).max(1_024),
      content: z.string().max(100_000),
      contentHash: z.string().min(1).max(200),
      dirty: z.boolean()
    }).optional(),
    relatedFiles: z.array(z.string().min(1).max(1_024)).max(200),
    diagnostics: z.array(protocolDiagnosticSchema).max(200),
    lastBuild: z.object({
      status: z.enum(['unknown', 'succeeded', 'failed']),
      summary: z.string().max(5_000).optional()
    }).optional()
  }),
  environmentState: z.object({
    cppStandard: z.enum(['c++17', 'c++20', 'c++23']),
    compiler: z.string().max(500).optional(),
    cmakeAvailable: z.boolean()
  }),
  conversationState: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(100_000)
    })).max(20)
  }),
  capabilities: z.object({
    workflows: z.array(agentWorkflowSchema).min(1).max(20),
    tools: z.array(protocolToolSchema).max(100)
  }),
  policy: z.object({
    allowedProjectId: z.string().uuid().optional(),
    allowedPaths: z.array(z.string().min(1).max(1_024)).max(500),
    writesRequireApproval: z.boolean(),
    approvalMode: z.enum(['always', 'on-risk', 'full']).default('on-risk'),
    maxSteps: z.number().int().positive().max(50),
    maxToolCalls: z.number().int().positive().max(100)
  })
})
export type AgentPlanRequest = z.infer<typeof agentPlanRequestSchema>

const agentPlanStepSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  kind: z.enum(['reason', 'resource', 'tool', 'approval', 'validate', 'respond', 'learning']),
  tool: z.string().min(1).max(120).optional(),
  arguments: z.record(z.string(), jsonValueSchema).default({}),
  dependsOn: z.array(z.string().min(1).max(100)).max(20).default([]),
  sideEffects: z.array(z.string().min(1).max(500)).max(100).default([]),
  summary: z.string().max(2_000).optional()
}).superRefine((step, context) => {
  if (['tool', 'validate', 'learning'].includes(step.kind) && !step.tool) {
    context.addIssue({ code: 'custom', path: ['tool'], message: '工具步骤必须声明 tool。' })
  }
})

export const agentPlanResponseSchema = z.object({
  protocol: z.literal('cpppilot.plan.response.v1'),
  taskId: z.string().uuid(),
  intent: z.object({
    primary: agentIntentSchema,
    secondary: z.array(agentIntentSchema).max(10).default([]),
    confidence: z.number().min(0).max(1)
  }),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().min(1).max(2_000).optional(),
  workflow: agentWorkflowSchema,
  contextRequests: z.array(z.object({
    kind: z.enum(['file', 'project-tree', 'diagnostics', 'build-state', 'learner-state']),
    target: z.string().max(1_024).optional(),
    reason: z.string().min(1).max(1_000)
  })).max(20),
  steps: z.array(agentPlanStepSchema).max(20),
  responseGoal: z.string().min(1).max(2_000)
}).superRefine((response, context) => {
  if (response.needsClarification && !response.clarificationQuestion) {
    context.addIssue({ code: 'custom', path: ['clarificationQuestion'], message: '需要澄清时必须给出问题。' })
  }
  const ids = new Set(response.steps.map(step => step.id))
  for (const [index, step] of response.steps.entries()) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) context.addIssue({ code: 'custom', path: ['steps', index, 'dependsOn'], message: `未知依赖步骤：${dependency}` })
    }
  }
})
export type AgentPlanResponse = z.infer<typeof agentPlanResponseSchema>

export const agentExecutionEvidenceSchema = z.object({
  stepId: z.string().min(1).max(100),
  tool: z.string().min(1).max(120).optional(),
  ok: z.boolean(),
  summary: z.string().max(20_000),
  changedFiles: z.array(z.string().min(1).max(1_024)).max(100).default([]),
  diagnostics: z.array(protocolDiagnosticSchema).max(200).default([]),
  exitCode: z.number().int().nullable().optional()
})
export type AgentExecutionEvidence = z.infer<typeof agentExecutionEvidenceSchema>

export const agentFinalRequestSchema = z.object({
  protocol: z.literal('cpppilot.final.request.v1'),
  taskId: z.string().uuid(),
  originalTask: z.string().min(1).max(20_000),
  intent: agentIntentSchema,
  execution: z.array(agentExecutionEvidenceSchema).max(50),
  learnerState: z.object({
    relevantConceptIds: z.array(z.string().min(1).max(100)).max(100),
    teachingInstructions: z.string().min(1).max(5_000)
  }),
  responseGoal: z.string().min(1).max(2_000)
})
export type AgentFinalRequest = z.infer<typeof agentFinalRequestSchema>

export const agentFinalResponseSchema = z.object({
  protocol: z.literal('cpppilot.final.response.v1'),
  taskId: z.string().uuid(),
  messageMarkdown: z.string().trim().min(1).max(100_000),
  suggestedConceptIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  suggestedNextActions: z.array(z.string().min(1).max(500)).max(20).default([])
})
export type AgentFinalResponse = z.infer<typeof agentFinalResponseSchema>
