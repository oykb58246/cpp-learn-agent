# H3 MCP 能力目录

## Transport 与统一结果

生产 Host 使用 MCP SDK stdio transport 启动 `out/main/mcp-worker.js`。所有工具先通过 Registry Zod Schema，再进入 DesktopMcpAdapter；返回统一 `ToolResult`：summary、structuredContent、diagnostics、artifacts、sideEffects、retryable、errorCode、exitCode 和 durationMs。

## Tools（24）

| Tool | 风险 | 超时 | 用途 |
|---|---:|---:|---|
| `toolchain.detect_compilers` | L0 | 30s | 检测候选 |
| `toolchain.probe_compiler` | L1 | 30s | Hello World 探测 |
| `toolchain.bind_compiler` | L2 | 30s | 持久化绑定 |
| `workspace.list_files` | L0 | 10s | 项目树 |
| `workspace.read_file` | L0 | 10s | 受限读取 |
| `workspace.create_file` | L2 | 10s | 创建文件 |
| `workspace.apply_patch` | L2 | 15s | hash 校验写入与 Diff 审批 |
| `workspace.create_snapshot` | L1 | 30s | 快照 |
| `compiler.build` | L1 | 60s | 单文件真实编译 |
| `program.run` | L2 | 30s | 受限运行 |
| `program.stop` | L0 | 5s | 取消进程树 |
| `cmake.build` | L1 | 120s | CMake configure/build |
| `ctest.run` | L1 | 120s | CTest |
| `analysis.clang_tidy` | L1 | 60s | 静态分析 |
| `debug.start` | L2 | 60s | GDB/MI 调试 |
| `debug.command` | L1 | 30s | continue/step/stop |
| `problem.parse` | L0 | 10s | 题目结构 |
| `project.create` | L2 | 30s | 创建学习项目 |
| `tests.generate_cases` | L0 | 10s | 确定性边界用例 |
| `tests.run_cases` | L2 | 120s | 构建并运行用例 |
| `vscode.open_file` | L1 | 10s | VS Code 新窗口定位 |
| `learning.get_state` | L0 | 5s | 学习/错误/复习状态 |
| `learning.record_error` | L2 | 5s | 错误本与验证奖励 |
| `learning.update_state` | L2 | 5s | 复习、知识和成长更新 |

## Resources（7）

- `cpplearn://project/{projectId}/tree`
- `cpplearn://project/{projectId}/files/{relativePath}`
- `cpplearn://project/{projectId}/diagnostics/latest`
- `cpplearn://project/{projectId}/problem`
- `cpplearn://learner/{userId}/knowledge-state`
- `cpplearn://learner/{userId}/error-book`
- `cpplearn://run/{runId}`

## Prompts（8）

- `explain_selection_with_known_concepts`
- `diagnose_compile_error`
- `find_logic_error_from_problem`
- `generate_progressive_hint`
- `review_code_without_rewriting`
- `create_project_plan`
- `generate_practice_for_error`
- `summarize_learning_session`

Prompt 只接收带来源标签的有界 context 和 allowedConcepts，不包含 API Key 或绝对路径。工具输出在模型 System Prompt 中明确标记为不可信数据。

## Progress、Cancellation 与 Timeout

- MCP progress 映射到 Timeline `progress`，只记录阶段、进度和总量。
- Runtime AbortSignal 传到 Client、Server Adapter 和 H2 长任务。
- 每工具使用 Registry timeout；进度可重置单次 timeout，但不能突破总上限。
- stdio initialize 默认 5 秒；失败关闭 Worker 并启用进程内本地降级通道。
