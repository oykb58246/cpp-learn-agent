import type { AgentRun, PetEvent } from '@cpp-pet/contracts'

export function petEventForRun(run: AgentRun, previousLevel: number, currentLevel: number): PetEvent {
  const base = { eventId: crypto.randomUUID(), runId: run.id }
  if (run.status === 'waiting-approval') return { ...base, state: 'approval', message: '等待操作确认' }
  if (run.status === 'executing' || run.status === 'validating') return { ...base, state: 'tool-running', message: run.status === 'validating' ? '正在验证结果' : '正在调用本地工具' }
  if (run.status === 'completed') {
    return currentLevel > previousLevel
      ? { ...base, state: 'level-up', message: `等级提升到 Lv.${currentLevel}` }
      : { ...base, state: 'success', message: run.validationSummary ?? '任务已完成' }
  }
  if (run.status === 'failed' || run.status === 'cancelled') return { ...base, state: 'warning', message: run.errorMessage ?? (run.status === 'cancelled' ? '任务已取消' : '任务未完成') }
  return { ...base, state: run.status === 'queued' ? 'listen' : 'thinking', message: run.status === 'queued' ? '收到学习请求' : '正在规划学习任务' }
}
