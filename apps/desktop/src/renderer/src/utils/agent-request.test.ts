import { describe, expect, it } from 'vitest'
import type { AgentStartRequest } from '@cpp-pet/contracts'
import { createAgentRequest, submitAgentRequestAfterContextSync } from './agent-request'

describe('Agent request transport', () => {
  it('preserves a malformed natural-language prompt and always uses auto mode', () => {
    const prompt = '帮我把 main.cpp 中的"Hello, C++Pilot!"改成"Hello, world!，编译成功后再解释 main、cout 和 endl 的作用。'

    const request = createAgentRequest(prompt, { source: 'editor', projectId: crypto.randomUUID(), activeFile: 'main.cpp' })

    expect(request.message).toBe(prompt)
    expect(request.mode).toBe('auto')
  })

  it('does not locally route explanation or diagnostic requests', () => {
    expect(createAgentRequest('解释 vector', { source: 'editor' }).mode).toBe('auto')
    expect(createAgentRequest('修复这个错误', { source: 'editor', diagnostics: [] }).mode).toBe('auto')
  })

  it('waits for the current editor context to synchronize before submitting the unchanged prompt', async () => {
    const prompt = '把目标字符串 "Hello, world! 后缺少的引号修好'
    const request = createAgentRequest(prompt, { source: 'editor', activeFile: 'main.cpp' })
    let contextContent = 'stale disk content'
    let submitted: AgentStartRequest | undefined

    const accepted = await submitAgentRequestAfterContextSync(
      request,
      async () => {
        await Promise.resolve()
        contextContent = 'latest editor draft'
        return true
      },
      async input => {
        expect(contextContent).toBe('latest editor draft')
        submitted = input
      }
    )

    expect(accepted).toBe(true)
    expect(submitted?.message).toBe(prompt)
  })

  it('does not submit an Agent request when the editor context cannot be synchronized', async () => {
    const request = createAgentRequest('解释当前代码', { source: 'editor', activeFile: 'main.cpp' })
    let submitted = false

    const accepted = await submitAgentRequestAfterContextSync(
      request,
      async () => false,
      async () => { submitted = true }
    )

    expect(accepted).toBe(false)
    expect(submitted).toBe(false)
  })
})
