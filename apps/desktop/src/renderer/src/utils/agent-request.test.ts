import { describe, expect, it } from 'vitest'
import { createAgentRequest } from './agent-request'

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
})
