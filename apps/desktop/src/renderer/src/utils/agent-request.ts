import type { AgentStartRequest } from '@cpp-pet/contracts'

export interface AgentRequestContext {
  source: AgentStartRequest['source']
  projectId?: string
  activeFile?: string
  selection?: NonNullable<AgentStartRequest['selection']>
  diagnostics?: NonNullable<AgentStartRequest['diagnostics']>
}

export function createAgentRequest(message: string, context: AgentRequestContext): AgentStartRequest {
  return {
    source: context.source,
    mode: 'auto',
    message,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.activeFile ? { activeFile: context.activeFile } : {}),
    ...(context.selection ? { selection: { ...context.selection } } : {}),
    ...(context.diagnostics?.length ? {
      diagnostics: context.diagnostics.map(item => ({ ...item, relatedConceptIds: [...item.relatedConceptIds] }))
    } : {})
  }
}

export async function submitAgentRequestAfterContextSync(
  request: AgentStartRequest,
  synchronizeContext: () => Promise<boolean>,
  submit: (request: AgentStartRequest) => Promise<unknown>
): Promise<boolean> {
  if (!await synchronizeContext()) return false
  await submit(request)
  return true
}
