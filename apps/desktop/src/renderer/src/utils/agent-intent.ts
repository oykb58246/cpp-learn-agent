import type { AgentStartRequest } from '@cpp-pet/contracts'

type IntentInput = Pick<AgentStartRequest, 'message' | 'selection' | 'diagnostics'>

const patterns = {
  environment: /环境|安装|配置|编译器|工具链|clang|gcc|g\+\+|cmake/i,
  project: /创建.{0,12}(项目|程序|工程)|新建.{0,12}(项目|程序|工程)|做一个.{0,12}(项目|程序)|项目需求/i,
  diagnose: /编译错误|报错|错误信息|error|warning|无法编译|修复.{0,12}(错误|报错)|缺少分号/i,
  solve: /逻辑.{0,12}(错误|问题|bug)|边界.{0,12}(错误|问题|bug)|结果不对|输出不对|算法.{0,12}(错误|问题|bug)|调试.{0,12}(逻辑|程序)/i,
  explain: /解释|讲解|说明|什么意思|是什么|怎么用|原理|作用|为什么/i
}

export function inferAgentMode(input: IntentInput): AgentStartRequest['mode'] {
  const message = input.message.trim()
  if (input.diagnostics?.length) return 'diagnose'
  if (patterns.environment.test(message)) return 'environment'
  if (patterns.project.test(message)) return 'project'
  if (patterns.diagnose.test(message)) return 'diagnose'
  if (patterns.solve.test(message)) return 'solve'
  if (input.selection?.content.trim() || patterns.explain.test(message)) return 'explain'
  return 'chat'
}
