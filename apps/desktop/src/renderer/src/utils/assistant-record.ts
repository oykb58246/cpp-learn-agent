import type { AgentRun } from '@cpp-pet/contracts'

export interface AssistantRecordSummary {
  title: string
  summary: string
  status: string
  nextAction: string
}

const titleByMode: Record<AgentRun['mode'], string> = {
  edit: '编辑与编译验证',
  auto: '智能助教任务',
  environment: '开发环境协助',
  explain: '代码与概念解释',
  diagnose: '报错诊断',
  solve: '逻辑问题分析',
  project: '项目协助',
  review: '代码与概念解释',
  chat: '问题解答'
}

const statusByRun: Record<AgentRun['status'], string> = {
  queued: '等待处理',
  contextualizing: '正在了解问题',
  'waiting-model-approval': '等待确认发送上下文',
  'model-requesting': '正在请求模型',
  'validating-model-output': '正在校验模型响应',
  planning: '正在分析',
  'policy-check': '正在准备讲解',
  'waiting-approval': '等待你的确认',
  executing: '正在处理',
  validating: '正在验证结果',
  responding: '正在整理说明',
  'waiting-input': '等待补充信息',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消'
}

export function summarizeAssistantRecord(run: AgentRun): AssistantRecordSummary {
  const nextAction = run.status === 'waiting-approval' || run.status === 'waiting-model-approval'
    ? '请查看需要确认的操作后继续。'
    : run.status === 'waiting-input'
      ? run.pendingClarification?.question ?? '请补充任务所需的信息。'
    : run.status === 'failed'
      ? '可补充代码、报错信息或期望结果后再次提问。'
      : run.status === 'completed'
        ? '可在项目中继续尝试；有新问题时直接向助教描述。'
        : '助教正在处理，完成后会给出解释和下一步建议。'
  return {
    title: titleByMode[run.mode],
    summary: run.response || run.validationSummary || run.planSummary || run.message,
    status: statusByRun[run.status],
    nextAction
  }
}
