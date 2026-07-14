# H2 已知问题

## 工具可用性

- 当前向导可以经用户确认打开 WinGet 安装终端，并在本次应用会话内跟踪退出状态；应用重启后不会恢复历史安装任务。
- MSYS2 本体安装后仍需用户在 UCRT64 终端执行固定 `pacman` 命令；全托管安装、校验和 PATH 修复仍属于后续版本。
- 当前开发机未安装 clangd 和 clang-tidy。LSP 客户端已通过假 Server 集成测试，clang-tidy 已覆盖解析器和缺失工具降级；LLVM 环境仍需人工实测。
- 调试后端当前只支持 GCC + GDB/MI2。
- LLDB、LLDB-DAP、GDB-DAP 和 MSVC 调试尚未接入。

## 调试范围

- 当前是单文件调试构建，只应用当前源文件上的断点。
- 多文件/CMake 可执行目标选择、跨源文件断点、线程和监视表达式尚未实现。
- 当前局部变量来自选中栈帧的 `-stack-list-variables --simple-values`，不展开复杂对象。
- 被调程序需要交互式标准输入时可能一直运行，当前调试面板没有 stdin 输入通道。
- GDB 7.6 的 MI 输出兼容已验证；其他版本仍需补充矩阵。

## clangd

- 每个项目当前只维护一个 clangd 会话。
- clangd 会话创建后不会因新的 CMake 构建自动重启；需要重新打开应用/项目以使用最新 compile database。
- 定义跳转当前使用返回结果中的第一处位置。
- 补全暂不处理 LSP snippet、复杂 text edit 和 additionalTextEdits。

## 构建与环境

- CMake 通过 ASCII 暂存源码目录构建，构建后修改代码需要重新执行“工程构建”。
- `pnpm test` 会把 `better-sqlite3` 切到 Node ABI。之后运行 Electron 前执行 `pnpm native:electron`。
- pnpm/npm 可能输出 `build-from-source` 配置弃用警告，当前重建仍成功；升级 npm 后需复核脚本。
- Renderer bundle 仍较大，Vite 会提示 chunk 大小；不影响 H2 功能，后续可按页面拆分。
