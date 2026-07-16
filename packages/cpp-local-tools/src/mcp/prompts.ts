import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const promptDefinitions = [
  ['explain_selection_with_known_concepts', '使用学习者已掌握的概念解释代码选区'],
  ['diagnose_compile_error', '根据编译证据解释首个根因'],
  ['find_logic_error_from_problem', '根据题目和失败用例定位逻辑错误'],
  ['generate_progressive_hint', '生成从轻到重的渐进提示'],
  ['review_code_without_rewriting', '审阅代码但不直接代写完整答案'],
  ['create_project_plan', '为学习项目生成受知识边界约束的计划'],
  ['generate_practice_for_error', '根据错误本生成复习练习'],
  ['summarize_learning_session', '总结已验证的学习证据与下一步']
] as const

export function registerTeachingPrompts(server: McpServer): void {
  for (const [name, description] of promptDefinitions) {
    server.registerPrompt(name, {
      title: description,
      description,
      argsSchema: {
        context: z.string().max(100_000).describe('带来源标签的最小上下文'),
        allowedConcepts: z.string().max(20_000).optional().describe('允许使用的概念 ID 列表')
      }
    }, async ({ context, allowedConcepts }) => ({
      description,
      messages: [{ role: 'user', content: { type: 'text', text: `${description}\n\n允许概念：${allowedConcepts ?? '由 Knowledge Gate 决定'}\n\n上下文：\n${context}` } }]
    }))
  }
}

