import { describe, expect, it } from 'vitest'
import type { AgentRun } from '@cpp-pet/contracts'
import { petEventForRun } from './pet-events'

const now = new Date().toISOString()
const run = (status: AgentRun['status']): AgentRun => ({
  id: crypto.randomUUID(), requestId: crypto.randomUUID(), source: 'main', mode: 'chat', message: '学习',
  status, steps: [], createdAt: now, updatedAt: now
})

describe('petEventForRun', () => {
  it('maps approval and tool execution into stable pet states', () => {
    expect(petEventForRun(run('waiting-approval'), 1, 1)).toMatchObject({ state: 'approval' })
    expect(petEventForRun(run('executing'), 1, 1)).toMatchObject({ state: 'tool-running' })
  })

  it('prioritizes a verified level increase over generic completion', () => {
    expect(petEventForRun(run('completed'), 2, 3)).toMatchObject({ state: 'level-up', message: '等级提升到 Lv.3' })
    expect(petEventForRun(run('completed'), 3, 3)).toMatchObject({ state: 'success' })
  })
})
