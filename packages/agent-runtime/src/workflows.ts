import type { ContextPacket } from '@cpp-pet/contracts'
import type { ResolvedAgentRequest, RuntimePlan, RuntimePlanner, RuntimePlanStep } from './runtime'

const ref = (stepId: string, path: string) => ({ $from: stepId, $path: path })

export class H3WorkflowPlanner implements RuntimePlanner {
  async plan(request: ResolvedAgentRequest, context: ContextPacket): Promise<RuntimePlan> {
    if (request.source === 'screenshot') return this.screenshot(request)
    switch (request.mode) {
      case 'environment': return this.environment(request)
      case 'project': return this.project(request)
      case 'explain': return this.explain(request)
      case 'diagnose': return this.diagnose(request, context)
      case 'solve': return this.logic(request, context)
      case 'review': return this.review(request)
      case 'chat': return this.chat()
    }
  }

  private environment(request: ResolvedAgentRequest): RuntimePlan {
    return {
      intent: 'environment-setup', conceptIds: [], successCriteria: ['compiler probe succeeds', 'toolchain is bound'], source: 'offline',
      steps: [
        step('detect', '检测本机工具链', 'tool', 'toolchain.detect_compilers', 'L0', {}),
        step('probe', '验证推荐编译器', 'tool', 'toolchain.probe_compiler', 'L1', { candidateId: ref('detect', 'candidates.0.id') }),
        step('bind', '绑定已验证工具链', 'tool', 'toolchain.bind_compiler', 'L2', { candidateId: ref('probe', 'candidate.id') }, ['persist-state']),
        { id: 'respond', title: '报告环境结果', kind: 'respond', summary: '已完成工具链检测、真实编译探测和绑定，当前 C++ 环境可以用于后续学习任务。' }
      ]
    }
  }

  private project(request: ResolvedAgentRequest): RuntimePlan {
    return {
      intent: 'create-project', conceptIds: [], successCriteria: ['project created', 'initial build succeeds'], source: 'offline',
      steps: [
        step('parse', '解析项目描述', 'tool', 'problem.parse', 'L0', { statement: request.message }),
        step('create', '创建学习项目', 'tool', 'project.create', 'L2', { mode: 'description', name: projectName(request.message), description: request.message }, ['create-file', 'persist-state']),
        step('build', '验证项目骨架', 'validate', 'compiler.build', 'L1', { runId: request.requestId, projectId: ref('create', 'projectId'), relativePath: ref('create', 'relativePath'), standard: 'c++17' }),
        { id: 'respond', title: '报告项目结果', kind: 'respond', summary: '学习项目骨架已经创建，并通过真实编译验证。' }
      ]
    }
  }

  private explain(request: ResolvedAgentRequest): RuntimePlan {
    const steps: RuntimePlanStep[] = []
    if (!request.selection && request.projectId && request.activeFile) steps.push(step('read', '读取最小文件上下文', 'tool', 'workspace.read_file', 'L0', { projectId: request.projectId, relativePath: request.activeFile }))
    steps.push({ id: 'respond', title: '按已学概念解释', kind: 'respond', summary: explainCode(request.selection?.content ?? request.message) })
    return { intent: 'explain-selection', conceptIds: inferConcepts(request.message), successCriteria: ['teaching response produced'], source: 'offline', steps }
  }

  private diagnose(request: ResolvedAgentRequest, context: ContextPacket): RuntimePlan {
    if (!request.projectId || !request.activeFile) return this.missingProject('diagnose-compile-error')
    const source = sourceContent(context)
    const fixed = fixCompileError(source)
    return {
      intent: 'diagnose-compile-error', conceptIds: inferConcepts(`${request.message}\n${source}`), successCriteria: ['first root cause recorded', 'rebuild succeeds'], source: 'offline',
      steps: [
        step('read', '读取当前文件', 'tool', 'workspace.read_file', 'L0', { projectId: request.projectId, relativePath: request.activeFile }),
        { ...step('build-failure', '编译并收集错误', 'tool', 'compiler.build', 'L1', { runId: request.requestId, projectId: request.projectId, relativePath: request.activeFile, standard: 'c++17' }), continueOnFailure: true },
        step('patch', '应用最小修复', 'tool', 'workspace.apply_patch', 'L2', { projectId: request.projectId, relativePath: request.activeFile, expectedHash: ref('read', 'contentHash'), content: fixed }, ['write-file']),
        step('rebuild', '重新编译验证', 'validate', 'compiler.build', 'L1', { runId: request.requestId, projectId: request.projectId, relativePath: request.activeFile, standard: 'c++17' }),
        step('learning', '记录错误修复证据', 'learning', 'learning.record_error', 'L2', {
          userId: 'local-user', projectId: request.projectId, relativePath: request.activeFile,
          category: 'compile', title: '编译错误修复', evidenceId: request.requestId,
          evidence: '重新编译通过', conceptIds: inferConcepts(`${request.message}\n${source}`), status: 'resolved'
        }, ['persist-state']),
        { id: 'respond', title: '解释根因与修复', kind: 'respond', summary: '首次编译证据定位到语句结束符问题；应用最小修改后，重新编译已经通过。' }
      ]
    }
  }

  private logic(request: ResolvedAgentRequest, context: ContextPacket): RuntimePlan {
    if (!request.projectId || !request.activeFile) return this.missingProject('find-logic-error')
    const source = sourceContent(context)
    const fixed = fixLogicBoundary(source)
    return {
      intent: 'find-logic-error', conceptIds: inferConcepts(`${request.message}\n${source}`), successCriteria: ['counterexample recorded', 'regression cases pass'], source: 'offline',
      steps: [
        step('read', '读取当前文件', 'tool', 'workspace.read_file', 'L0', { projectId: request.projectId, relativePath: request.activeFile }),
        step('build', '编译当前程序', 'tool', 'compiler.build', 'L1', { runId: request.requestId, projectId: request.projectId, relativePath: request.activeFile, standard: 'c++17' }),
        step('generate', '生成边界测试', 'tool', 'tests.generate_cases', 'L0', { statement: request.message, count: 5 }),
        { ...step('cases-before', '运行并寻找反例', 'tool', 'tests.run_cases', 'L2', { runId: request.requestId, projectId: request.projectId, relativePath: request.activeFile, cases: ref('generate', 'cases') }, ['run-program']), continueOnFailure: true },
        step('patch', '应用边界修复', 'tool', 'workspace.apply_patch', 'L2', { projectId: request.projectId, relativePath: request.activeFile, expectedHash: ref('read', 'contentHash'), content: fixed }, ['write-file']),
        step('cases-after', '执行回归测试', 'validate', 'tests.run_cases', 'L2', { runId: request.requestId, projectId: request.projectId, relativePath: request.activeFile, cases: ref('generate', 'cases') }, ['run-program']),
        step('learning', '记录逻辑修复证据', 'learning', 'learning.record_error', 'L2', {
          userId: 'local-user', projectId: request.projectId, relativePath: request.activeFile,
          category: 'logic', title: '循环边界逻辑错误', evidenceId: request.requestId,
          evidence: '边界用例回归通过', conceptIds: inferConcepts(`${request.message}\n${source}`), status: 'resolved'
        }, ['persist-state']),
        { id: 'respond', title: '解释最小反例', kind: 'respond', summary: '边界用例暴露了循环终止条件的偏差；收紧边界后，回归用例已经全部通过。' }
      ]
    }
  }

  private screenshot(request: ResolvedAgentRequest): RuntimePlan {
    return {
      intent: 'explain-screenshot', conceptIds: [], successCriteria: ['screenshot scope approved'], source: 'offline',
      steps: [
        {
          id: 'screenshot-approval', title: '确认截图上下文范围', kind: 'approval', risk: 'L3',
          arguments: { screenshotId: request.screenshot?.id, width: request.screenshot?.width, height: request.screenshot?.height },
          sideEffects: ['remote-request']
        },
        { id: 'respond', title: '解释已授权截图', kind: 'respond', summary: 'H4 截图提供器接入后可发送像素内容。' }
      ]
    }
  }

  private review(request: ResolvedAgentRequest): RuntimePlan {
    return {
      intent: 'explain-follow-up', conceptIds: ['control.loops'], successCriteria: ['follow-up explanation produced'], source: 'offline',
      steps: [
        {
          id: 'respond', title: '补充解释与建议', kind: 'respond',
          summary: '我会根据你这次的问题补充解释，并给出可以在项目中继续尝试的下一步；不会记录成绩、复习进度或掌握状态。'
        }
      ]
    }
  }

  private chat(): RuntimePlan {
    return { intent: 'teaching-chat', conceptIds: [], successCriteria: ['safe response'], source: 'offline', steps: [{ id: 'respond', title: '教学回答', kind: 'respond', summary: '请提供具体代码、诊断或题目要求，我会按当前学习范围给出可验证的解释。' }] }
  }

  private missingProject(intent: string): RuntimePlan {
    return { intent, conceptIds: [], successCriteria: ['request project context'], source: 'offline', steps: [{ id: 'respond', title: '请求项目与当前文件', kind: 'respond', summary: '当前任务缺少项目或活动文件，请先在工作区打开需要分析的 C++ 文件。' }] }
  }
}

function step(
  id: string,
  title: string,
  kind: RuntimePlanStep['kind'],
  toolName: string,
  risk: NonNullable<RuntimePlanStep['risk']>,
  args: Record<string, unknown>,
  sideEffects?: string[]
): RuntimePlanStep {
  return { id, title, kind, toolName, risk, arguments: args, ...(sideEffects ? { sideEffects } : {}) }
}

function sourceContent(context: ContextPacket): string {
  return context.sources.find(source => source.kind === 'file')?.content
    ?? context.sources.find(source => source.kind === 'selection')?.content
    ?? ''
}

function fixCompileError(content: string): string {
  return content.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.endsWith(';') || trimmed.endsWith('{') || trimmed.endsWith('}')) return line
    if (/^(return|cout\b|std::cout\b|[a-zA-Z_]\w*\s*=)/.test(trimmed)) return `${line};`
    return line
  }).join('\n')
}

function fixLogicBoundary(content: string): string {
  return content.replace(/(\bfor\s*\([^;]+;\s*[^;]+)\s*<=\s*([^;]+;)/, '$1 < $2')
}

function inferConcepts(text: string): string[] {
  const concepts: string[] = []
  if (/循环|\bfor\b|\bwhile\b/.test(text)) concepts.push('control.loops')
  if (/数组|\[[^\]]*\]/.test(text)) concepts.push('data.arrays')
  if (/函数|\breturn\b/.test(text)) concepts.push('functions.basic')
  return concepts
}

function projectName(description: string): string {
  const normalized = description.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 24)
  return normalized || 'Agent 学习项目'
}

function explainCode(content: string): string {
  if (/\breturn\b/.test(content)) return '`return` 会结束当前函数，并把后面的值作为函数结果交给调用者。'
  if (/\b(?:for|while)\b/.test(content)) return '这段代码通过循环重复执行语句；判断循环边界时需要确认起点、终点和步长。'
  if (/\b(?:std::)?cout\b/.test(content)) return '这段代码使用输出流把值写到标准输出，`<<` 表示依次写入内容。'
  return `当前选区共 ${Math.max(1, content.split(/\r?\n/).length)} 行；可以从表达式求值顺序和变量作用域逐步阅读。`
}
