import { z } from 'zod'
import type { ToolRisk } from '@cpp-pet/contracts'

const uuid = z.string().uuid()
const relativePath = z.string().min(1).max(1_024).refine(value => {
  const normalized = value.replaceAll('\\', '/')
  return !normalized.startsWith('/') && !/^[a-z]:/i.test(normalized) && !normalized.split('/').includes('..')
}, 'Path must stay inside the project root')
const standard = z.enum(['c++17', 'c++20', 'c++23']).default('c++17')

export interface LocalToolDefinition {
  name: string
  title: string
  description: string
  risk: ToolRisk
  timeoutMs: number
  inputSchema: z.ZodType<Record<string, unknown>>
}

const tool = (
  name: string,
  title: string,
  risk: ToolRisk,
  timeoutMs: number,
  inputSchema: z.ZodType<Record<string, unknown>>,
  description = title
): LocalToolDefinition => ({ name, title, description, risk, timeoutMs, inputSchema })

export const localToolDefinitions: LocalToolDefinition[] = [
  tool('toolchain.detect_compilers', '检测 C++ 工具链', 'L0', 30_000, z.object({})),
  tool('toolchain.probe_compiler', '验证编译器候选', 'L1', 30_000, z.object({ candidateId: z.string().min(1).max(500) })),
  tool('toolchain.bind_compiler', '绑定编译器', 'L2', 30_000, z.object({ candidateId: z.string().min(1).max(500) })),
  tool('workspace.list_files', '列出项目文件', 'L0', 10_000, z.object({ projectId: uuid })),
  tool('workspace.read_file', '读取项目文件', 'L0', 10_000, z.object({ projectId: uuid, relativePath })),
  tool('workspace.create_file', '创建项目文件', 'L2', 10_000, z.object({ projectId: uuid, relativePath, content: z.string().max(2_097_152) })),
  tool('workspace.apply_patch', '应用文件修改', 'L2', 15_000, z.object({ projectId: uuid, relativePath, expectedHash: z.string().max(128), content: z.string().max(2_097_152) })),
  tool('workspace.create_snapshot', '创建项目快照', 'L1', 30_000, z.object({ projectId: uuid, label: z.string().max(100) })),
  tool('compiler.build', '编译当前文件', 'L1', 60_000, z.object({ runId: uuid, projectId: uuid, relativePath, standard })),
  tool('program.run', '运行已构建程序', 'L2', 30_000, z.object({
    runId: uuid,
    buildId: uuid.or(z.string().min(1).max(200)),
    input: z.string().max(65_536).default(''),
    timeoutMs: z.number().int().min(100).max(30_000).default(5_000)
  })),
  tool('program.stop', '停止运行程序', 'L0', 5_000, z.object({ runId: uuid })),
  tool('cmake.build', '构建 CMake 工程', 'L1', 120_000, z.object({ runId: uuid, projectId: uuid, configuration: z.enum(['Debug', 'Release']).default('Debug'), standard })),
  tool('ctest.run', '运行 CTest', 'L1', 120_000, z.object({ runId: uuid, buildId: z.string().min(1).max(200), timeoutMs: z.number().int().min(100).max(120_000).default(30_000) })),
  tool('analysis.clang_tidy', '执行静态分析', 'L1', 60_000, z.object({ runId: uuid, projectId: uuid, relativePath })),
  tool('debug.start', '启动断点调试', 'L2', 60_000, z.object({ projectId: uuid, relativePath, standard, breakpoints: z.array(z.object({ relativePath, line: z.number().int().positive() })).max(100) })),
  tool('debug.command', '控制调试会话', 'L1', 30_000, z.object({ sessionId: uuid, command: z.enum(['continue', 'next', 'step-in', 'step-out', 'stop']) })),
  tool('problem.parse', '解析题目结构', 'L0', 10_000, z.object({ statement: z.string().min(1).max(100_000) })),
  tool('project.create', '创建学习项目', 'L2', 30_000, z.object({ mode: z.enum(['problem', 'description']), name: z.string().min(1).max(80), description: z.string().max(100_000) })),
  tool('tests.generate_cases', '生成候选测试用例', 'L0', 10_000, z.object({ statement: z.string().min(1).max(100_000), count: z.number().int().min(1).max(20).default(5) })),
  tool('tests.run_cases', '运行题目测试用例', 'L2', 120_000, z.object({
    runId: uuid,
    projectId: uuid,
    relativePath,
    cases: z.array(z.object({ input: z.string().max(65_536), expectedOutput: z.string().max(65_536) })).min(1).max(100)
  })),
  tool('vscode.open_file', '在 VS Code 打开文件', 'L1', 10_000, z.object({ projectId: uuid, relativePath: relativePath.optional(), line: z.number().int().positive().optional(), column: z.number().int().positive().optional() })),
  tool('learning.get_state', '读取学习状态', 'L0', 5_000, z.object({
    userId: z.string().min(1).max(100).default('local-user'),
    reviewItemId: uuid.optional()
  })),
  tool('learning.record_error', '记录已验证错误', 'L2', 5_000, z.object({
    userId: z.string().min(1).max(100).default('local-user'),
    projectId: uuid.optional(),
    relativePath: relativePath.optional(),
    category: z.enum(['compile', 'linker', 'runtime', 'logic', 'analysis', 'debug']),
    title: z.string().min(1).max(200),
    evidenceId: z.string().min(1).max(200),
    evidence: z.string().min(1).max(20_000),
    conceptIds: z.array(z.string().min(1).max(100)).max(100),
    status: z.enum(['open', 'resolved']).default('resolved')
  })),
  tool('learning.update_state', '更新学习状态', 'L2', 5_000, z.object({
    userId: z.string().min(1).max(100).default('local-user'),
    conceptId: z.string().min(1).max(100),
    status: z.enum(['available', 'learning', 'self-claimed', 'verified', 'review']),
    evidenceId: z.string().min(1).max(200),
    reviewItemId: uuid.optional(),
    reviewOutcome: z.enum(['passed', 'failed']).optional()
  }).superRefine((input, context) => {
    if (input.status === 'verified' && (!input.reviewItemId || input.reviewOutcome !== 'passed')) {
      context.addIssue({ code: 'custom', path: ['reviewItemId'], message: '验证知识状态必须引用通过的复习项。' })
    }
  }))
]
