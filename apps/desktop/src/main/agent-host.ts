import type { AgentContinueRequest, AgentRun, AgentRunDetail, AgentStartRequest, ApprovalDecision } from '@cpp-pet/contracts'
import type { AgentRuntimeController } from '@cpp-pet/agent-runtime'

export class AgentHost {
  private readonly listeners = new Set<(run: AgentRun) => void>()

  constructor(private readonly runtime: AgentRuntimeController) {
    runtime.onChanged(run => this.publish(run))
  }

  async start(input: AgentStartRequest): Promise<AgentRun> {
    const run = await this.runtime.start(input)
    return run
  }

  async continue(input: AgentContinueRequest): Promise<AgentRun> {
    return this.runtime.continue(input)
  }

  get(runId: string): AgentRunDetail | undefined { return this.runtime.get(runId) }
  list(): AgentRun[] { return this.runtime.list() }

  async decide(input: ApprovalDecision): Promise<AgentRun> {
    const run = await this.runtime.decide(input)
    return run
  }

  async cancel(runId: string): Promise<AgentRun> {
    const run = await this.runtime.cancel(runId)
    return run
  }

  async shutdown(): Promise<void> { await this.runtime.shutdown() }

  onChanged(listener: (run: AgentRun) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(run: AgentRun): void {
    for (const listener of this.listeners) listener(structuredClone(run))
  }
}
