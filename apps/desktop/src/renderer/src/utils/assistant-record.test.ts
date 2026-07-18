import { describe, expect, it } from 'vitest'
import type { AgentRun } from '@cpp-pet/contracts'
import { summarizeAssistantRecord } from './assistant-record'

const now = new Date().toISOString()

describe('summarizeAssistantRecord', () => {
  it('converts a legacy review run into an understandable assistant record', () => {
    const run: AgentRun = {
      id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main', mode: 'review',
      message: '循环边界仍然不熟悉', status: 'completed', steps: [],
      response: '循环结束条件应在访问数组前判断。', createdAt: now, updatedAt: now
    }

    expect(summarizeAssistantRecord(run)).toEqual({
      title: '代码与概念解释',
      summary: '循环结束条件应在访问数组前判断。',
      status: '已完成',
      nextAction: '可在项目中继续尝试；有新问题时直接向助教描述。'
    })
  })
})
