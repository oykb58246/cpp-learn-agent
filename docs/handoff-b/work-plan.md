# 成员 B H2 工作计划与完成状态

## 第 1 批：环境绑定

状态：已完成。

- 工具链共享契约、受限子进程和结构化结果。
- GCC、Clang、MSVC、CMake、调试器、clangd 和 VS Code 探测。
- Hello World 编译运行烟雾验证。
- `ToolchainProfile` SQLite 持久化、健康检查和设置页。
- 固定 C++ 回归样例库。

## 第 2 批：编辑与编译运行

状态：已完成。

- 用 Monaco Editor 替换基础文本域，复用现有 `FileDocument` 和 `FileRevision`。
- 自动保存、外部修改哈希冲突和 Monaco Diff Editor。
- 单文件编译、运行、停止、超时、输出限制和进程回收。
- GCC、Clang、MSVC 编译与链接诊断标准化。
- 工作区工具栏和输出/问题面板。

验证记录见 `docs/handoff-b/batch-2-test-report.md`。

## 第 3 批：工程、语义与外部联动

状态：已完成。

- 已完成 CMake configure/build、CTest 和 `compile_commands.json`。
- 已完成 clang-tidy 静态分析 IPC、诊断标准化与缺失工具降级。
- 已完成 VS Code `-n` 新窗口打开项目与 `-g` 定位文件行列。
- 已完成中文工作区的 ASCII 暂存构建，避免旧 MinGW Make 的路径编码失败。
- 已完成标准 LSP stdio 客户端、文档同步、诊断、补全、悬停和定义跳转。
- 已完成 Monaco Provider、实时诊断合并和 clangd 缺失降级。
- 已完成统一调试 API、GDB/MI 后端、断点、继续、跨过、进入、跳出和停止。
- 已完成当前暂停行、局部变量、调用栈和调试输出面板。
- 已完成中文项目路径的调试源码暂存与位置回映射。

验证记录见 `docs/handoff-b/batch-3-engineering-test-report.md`。

## 第 4 批：首次体验与环境安装引导

状态：已完成。

- 全新用户数据首次启动自动进入初始化向导。
- 完成、跳过和首页提醒状态持久化，并兼容旧版本 settings。
- 跳过前展示明确找回路径，首页和设置页均可重新进入。
- 根据真实检测结果生成 MSYS2、LLVM、CMake 和 VS Code 安装方案。
- WinGet 可用性检测、原生确认框、白名单可见安装终端、任务状态事件和安装后自动复检。
- MSYS2 UCRT64 GCC/GDB 后续安装命令提示。
- 33 个单元/契约测试与 2 条 Electron E2E 通过。

## 第 5 批：工作区布局与交接收尾

状态：已完成。

- 文件侧边栏、快照侧边栏和底部输出/问题/调试面板支持鼠标拖拽。
- 支持方向键微调和双击恢复默认尺寸。
- 布局尺寸写入 `AppSettings` 并通过 SQLite 跨重启持久化。
- 1024×720 下自动保留最小编辑区域，底部页签和输入框不重叠。
- Electron E2E 覆盖真实拖拽、设置写入和页面重载恢复。
- H2 交接入口、运行手册、验收清单、契约和已知问题已同步。

## 交接状态

成员 B H2 范围已达到交接条件。交接基线使用 `handoff-b-v1.0` 标签，成员 C 从 `docs/handoff-b/handoff.md` 开始接收。

## 后续建议

- 持久化安装任务，应用重启后恢复最近安装状态。
- 增加 WinGet 软件包可用性预检和下载失败诊断。
- 为 MSYS2 提供受控的 UCRT64 包安装助手，并验证 GCC/GDB 后再绑定。
- 在真实 LLVM 环境补充 clangd 与 clang-tidy 人工验收。
