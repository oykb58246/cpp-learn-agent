import { describe, expect, it } from 'vitest'
import { inferAgentMode } from './agent-intent'

describe('agent intent routing', () => {
  it('prioritizes diagnostics and selected code over generic wording', () => {
    expect(inferAgentMode({ message: '这段代码是什么意思？', diagnostics: [{
      source: 'compiler', file: 'main.cpp', line: 3, column: 10, severity: 'error',
      rawMessage: 'expected ;', normalizedMessage: 'expected ;', relatedConceptIds: []
    }] })).toBe('diagnose')
    expect(inferAgentMode({ message: '帮我看看', selection: {
      startLine: 1, startColumn: 1, endLine: 2, endColumn: 1, content: 'for (;;) {}'
    } })).toBe('explain')
  })

  it('routes project, environment, diagnosis, logic, and explanation prompts', () => {
    expect(inferAgentMode({ message: '创建一个学生成绩管理项目' })).toBe('project')
    expect(inferAgentMode({ message: '帮我安装并配置 C++ 编译器' })).toBe('environment')
    expect(inferAgentMode({ message: '修复当前编译错误并解释根因' })).toBe('diagnose')
    expect(inferAgentMode({ message: '循环边界结果不对，检查逻辑 bug' })).toBe('solve')
    expect(inferAgentMode({ message: '解释 vector 的作用和用法' })).toBe('explain')
  })

  it('falls back to chat for open-ended questions', () => {
    expect(inferAgentMode({ message: '你好，今天适合学什么？' })).toBe('chat')
  })
})
