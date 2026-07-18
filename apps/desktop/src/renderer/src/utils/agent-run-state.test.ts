import { describe, expect, it } from 'vitest'
import { isAgentRunBusy } from './agent-run-state'

describe('Agent run UI state', () => {
  it('allows input while the model is waiting for clarification', () => {
    expect(isAgentRunBusy('waiting-input')).toBe(false)
  })

  it('keeps approvals and active model/tool work busy', () => {
    for (const status of ['queued', 'contextualizing', 'waiting-model-approval', 'model-requesting', 'waiting-approval', 'executing'] as const) {
      expect(isAgentRunBusy(status)).toBe(true)
    }
    for (const status of ['completed', 'failed', 'cancelled'] as const) expect(isAgentRunBusy(status)).toBe(false)
  })
})
