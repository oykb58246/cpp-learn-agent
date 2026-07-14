# 成员 B 第 2 批测试报告

验证日期：2026-07-14

## 已交付

- Monaco Editor 多标签模型、C++ 高亮、行号、括号与快捷保存。
- 1.2 秒自动保存，继续复用 `FileDocument`、`FileRevision`、内容哈希和保存前快照。
- 外部修改冲突读取与 Monaco Diff Editor，对用户提供使用磁盘版本或覆盖磁盘版本。
- `compiler:build`、`program:run`、`program:stop` 固定 IPC。
- GCC、Clang、MSVC 单文件编译适配，构建产物保存在 Electron `userData/builds`。
- 运行输入、5 秒默认超时、512 KiB 输出上限、取消和 Windows 进程树回收。
- GCC/Clang 与 MSVC 编译诊断、链接诊断和运行时诊断标准化。
- 工作区编译/运行/停止工具栏、输出面板、问题面板和 Monaco 行内标记。

## 安全边界

- Renderer 只能提交 `projectId + relativePath`，不能提交源文件、构建产物或编译器绝对路径。
- Main 通过 `WorkspaceService.projectRoot()` 和 `safePath()` 解析源文件。
- 只有已信任工作区和已绑定工具链可以编译或运行。
- Main 持有 `AbortController` 与构建产物映射，Preload 未增加通用 IPC。
- 应用启动时清理上次会话构建目录，退出时取消仍在运行的任务。

## 验证结果

| 项目 | 结果 |
|---|---|
| Contracts TypeScript | 通过 |
| cpp-local-tools TypeScript | 通过 |
| Desktop Vue / Main / Preload TypeScript | 通过 |
| Contracts Vitest | 5 个通过 |
| cpp-local-tools Vitest | 6 个通过 |
| Electron 生产构建 | Main、Preload、Renderer、Monaco Worker 全部通过 |
| Electron Playwright E2E | 1 个通过 |
| 真实成功样例 | GCC 编译和运行通过 |
| 真实语法错误样例 | 编译失败并生成结构化诊断 |
| 真实链接错误样例 | 识别为 `linker` 诊断 |
| 真实死循环样例 | 超时并生成 `RUN_TIMEOUT` |
| 真实崩溃样例 | 非零退出并生成 `RUN_NON_ZERO_EXIT` |
| 真实取消 | 子进程被取消并完成回收 |

E2E 覆盖安全 Preload、工具链真实绑定、Monaco 编辑保存、快照、实际编译运行、输出面板、1024×720 响应式布局和深色主题。

## 当前限制

- 第 2 批只支持单个 `.cpp`、`.cc` 或 `.cxx` 文件直接编译；多文件与 CMake 留在第 3 批。
- 诊断说明目前是标准化编译器文本，面向初学者的中文教学解释由后续 Agent 工作流接入。
- Monaco 语义能力尚未连接 clangd，当前补全仅为编辑器基础能力。
- 构建产物只在当前应用会话内可运行，应用重启后需要重新编译。
