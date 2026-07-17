import type { AgentStartRequest } from '@cpp-pet/contracts'

export type ProductTourStepId = 'welcome' | 'navigation' | 'assistant-input' | 'assistant-result' | 'workspace-agent' | 'complete'
export type ProductTourAgentPhase = 'idle' | 'approval' | 'running' | 'ready' | 'failed'

export interface ProductTourStep {
  id: ProductTourStepId
  route?: '/home' | '/runs' | '/workspace'
  target?: string
  title: string
  body: string
  interactive?: boolean
}

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface SizeLike {
  width: number
  height: number
}

export const agentTourSuggestion = {
  label: '试着解释这段循环',
  mode: 'explain' as AgentStartRequest['mode'],
  message: '请用零基础能听懂的方式解释这段代码：\nfor (int i = 0; i < 3; ++i) {\n  std::cout << i << "\\n";\n}'
}

export const beginnerTourSteps: ProductTourStep[] = [
  {
    id: 'welcome',
    route: '/home',
    target: '[data-tour="quick-start"]',
    title: '五分钟认识 CppPilot',
    body: '先看清功能入口，再亲自问助教一个问题。'
  },
  {
    id: 'navigation',
    target: '[data-tour="activity-rail"]',
    title: '四个主要区域',
    body: '首页负责开始，工作区处理代码，知识树记录背景，助教记录保留解释过程。'
  },
  {
    id: 'assistant-input',
    route: '/runs',
    target: '[data-tour="assistant-composer"]',
    title: '向助教提出第一个问题',
    body: '选择示例问题，确认内容后由你亲自发送。',
    interactive: true
  },
  {
    id: 'assistant-result',
    route: '/runs',
    target: '[data-tour="assistant-result"]',
    title: '看懂助教结果',
    body: '先读解释和下一步，需要时再展开处理过程。'
  },
  {
    id: 'workspace-agent',
    route: '/workspace',
    target: '[data-tour="workspace-agent-toggle"]',
    title: '在代码旁继续提问',
    body: '打开项目和文件后，可以让助教解释选区、诊断报错或检查逻辑。'
  },
  {
    id: 'complete',
    title: '已经可以开始了',
    body: '你已经完成一次真实助教问答，也知道如何回到代码旁继续。'
  }
]

export function progressForStep(step: number) {
  const completed = step >= 5 ? 3 : step >= 3 ? 2 : step >= 1 ? 1 : 0
  return { completed, total: 3 }
}

export function productTourTarget(step: ProductTourStep, agentPhase: ProductTourAgentPhase) {
  if (step.id === 'assistant-input' && agentPhase === 'approval') return '[data-tour="assistant-approval"]'
  if (step.id === 'assistant-input' && (agentPhase === 'running' || agentPhase === 'ready')) {
    return '[data-tour="assistant-progress"]'
  }
  return step.target
}

export function panelPlacement(target: RectLike | null, viewport: SizeLike, panel: SizeLike) {
  const margin = 16
  const gap = 24
  const clampLeft = (value: number) => Math.min(Math.max(margin, value), Math.max(margin, viewport.width - panel.width - margin))
  const clampTop = (value: number) => Math.min(Math.max(margin, value), Math.max(margin, viewport.height - panel.height - margin))

  if (!target) {
    return {
      left: clampLeft((viewport.width - panel.width) / 2),
      top: clampTop((viewport.height - panel.height) / 2),
      centered: true
    }
  }

  if (target.right + gap + panel.width <= viewport.width - margin) {
    return { left: target.right + gap, top: clampTop(target.top), centered: false }
  }
  if (target.left - gap - panel.width >= margin) {
    return { left: target.left - gap - panel.width, top: clampTop(target.top), centered: false }
  }
  if (target.bottom + gap + panel.height <= viewport.height - margin) {
    return { left: clampLeft(target.left), top: target.bottom + gap, centered: false }
  }
  if (target.top - gap - panel.height >= margin) {
    return { left: clampLeft(target.left), top: target.top - gap - panel.height, centered: false }
  }

  return {
    left: clampLeft((viewport.width - panel.width) / 2),
    top: clampTop((viewport.height - panel.height) / 2),
    centered: true
  }
}
