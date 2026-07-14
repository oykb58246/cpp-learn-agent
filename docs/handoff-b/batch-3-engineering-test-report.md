# 成员 B 第 3 批工程工具测试报告

验证日期：2026-07-14

## 已交付

- `cmake:build`、`ctest:run`、`analysis:clang-tidy`、`vscode:open` 固定 IPC。
- CMake configure/build、Debug/Release 配置与 C++17/C++20/C++23 选择。
- 构建目录与 ASCII 源码暂存目录位于 Electron `userData/builds`，不污染项目目录。
- `compile_commands.json` 生成与最近构建映射。
- CTest 通过、失败、超时、取消和测试计数标准化。
- clang-tidy 诊断转换为共享 `Diagnostic`，并显示在问题面板和 Monaco 标记中。
- VS Code 使用 `-n` 新窗口打开项目，以及按当前文件、行和列定位，不替换已有工作区窗口。
- 工作区工程构建、测试、静态分析和外部编辑器工具栏。
- 固定多文件 CMake/CTest 回归样例。
- 标准 JSON-RPC/LSP stdio 客户端、Monaco C++ 补全、悬停、定义跳转和实时诊断。
- clangd 不可用时保持基础编辑模式，并在状态栏说明安装要求。
- 统一调试 IPC 与 GDB/MI 后端，支持断点、继续、跨过、进入、跳出和停止。
- Monaco 断点槽、当前暂停行、局部变量、调用栈和调试器输出。
- 调试源码使用 ASCII 构建目录暂存，并将位置回映射到中文项目中的原文件。
- Node/Electron `better-sqlite3` ABI 切换脚本适配 pnpm 10.24.0。
- 首次启动环境初始化向导，覆盖自动检测、推荐工具链、Hello World 验证绑定、工作区授权和完成确认。
- 设置页可重新进入环境向导；缺失组件通过固定官方下载入口引导用户安装。
- 跳过向导时展示找回路径，首页保留可重新进入的环境提醒。
- WinGet 可用性检测与白名单安装终端，安装过程在可见 PowerShell 窗口中进行。
- 安装任务状态查询与受限事件通知；成功结束后向导自动重新检测环境。
- 文件侧边栏、快照侧边栏和底部面板支持拖拽、键盘调整、复位和 SQLite 持久化。

## 安全边界

- Renderer 只提交 `projectId`、项目内相对路径、行列和固定选项。
- Main 使用 `WorkspaceService.projectRoot()` 与 `safePath()` 解析目标。
- CTest 只能运行当前应用会话中成功创建的 CMake 构建目录。
- clang-tidy 只能分析授权项目内的 C++ 文件。
- CMake、CTest、clang-tidy 和 VS Code 均由固定工具路径与参数调用，不接受任意命令文本。
- 环境下载 IPC 只接受 `msys2`、`llvm`、`cmake`、`vscode`、`visual-studio` 枚举，并由 Main 打开预设官方页面。
- 环境安装 IPC 只接受 `msys2`、`llvm`、`cmake`、`vscode`，软件包 ID 与命令由 Main 固定。
- 安装前使用 Electron 原生确认框，随后打开可见终端；不会后台静默安装或直接修改系统 `PATH`。
- 所有长任务复用超时、取消、输出上限和 Windows 进程树回收。

## 验证结果

| 项目 | 结果 |
|---|---|
| 全工作区 TypeScript / Vue | 通过 |
| Contracts Vitest | 8 个通过 |
| cpp-local-tools Vitest | 12 个通过 |
| Database Vitest | 4 个通过 |
| workspace-core Vitest | 6 个通过 |
| Desktop 安装结果策略 Vitest | 3 个通过 |
| 全部单元/契约测试 | 33 个通过 |
| 假 LSP Server 集成测试 | 同步、诊断、补全、悬停、定义均通过 |
| 真实 GCC + GDB/MI | 断点、变量 41→42、单步、结束均通过 |
| 真实 CMake + GCC 多文件构建 | 通过 |
| 中文仓库路径构建 | 通过 |
| `compile_commands.json` | 已生成 |
| 真实 CTest | 1/1 通过 |
| Electron 生产构建 | 通过 |
| Electron Playwright E2E | 2 个通过，包含跳过恢复、安装事件、完整首次向导、布局拖拽恢复、真实 CMake/CTest 和 GDB 调试 |
| 1440x900 与 1024x720 布局 | 首页、工作区、可调整面板和初始化向导通过 |

## 当前限制

- 本机未安装 clangd，因此客户端以假 LSP Server 验证协议和 UI 契约；真实 clangd 执行需在安装 LLVM 后补一次人工验收。
- 本机未安装 clang-tidy，因此已验证解析器、IPC、权限与缺失工具降级；真实 clang-tidy 执行待 LLVM 环境补充。
- 当前统一调试 API 使用 GDB/MI 后端，不是 DAP；LLDB、MSVC 和多文件 CMake 调试尚未接入。
- 单文件调试只应用当前源文件上的断点；其他文件的断点会在本次会话中忽略。
- CMake 当前按项目快照构建；修改代码后需要重新执行工程构建。
- WinGet 安装任务只保存在当前 Main 进程内；应用重启后不会恢复历史任务。
- MSYS2 安装完成后仍需在 UCRT64 终端安装 GCC/GDB 工具包；向导会展示固定命令。
