import type { AgentRunStatus } from '@cpp-pet/contracts'

const idleStatuses = new Set<AgentRunStatus>(['waiting-input', 'completed', 'failed', 'cancelled'])

export function isAgentRunBusy(status: AgentRunStatus | undefined): boolean {
  return Boolean(status && !idleStatuses.has(status))
}
