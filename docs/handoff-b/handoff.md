# 成员 B H2 交接说明

交接日期：2026-07-14

## 交接基线

- 分支：`stage/b-cpp-tools`
- 标签：`handoff-b-v1.0`
- 上游基础：成员 A 的 `cc1cd96`
- H2 主体提交：`4ca8972`、`e608361` 及交接收尾提交

成员 C 接手后不要只拉取 `main`。在合并完成前，应检出 `stage/b-cpp-tools` 或 `handoff-b-v1.0`。

## 建议阅读顺序

1. `docs/handoff-b/handoff.md`
2. `docs/handoff-b/runbook.md`
3. `docs/handoff-b/contracts.md`
4. `docs/handoff-b/h2-acceptance.md`
5. `docs/handoff-b/known-issues.md`
6. `docs/handoff-b/batch-3-engineering-test-report.md`

## 已交付能力

- Windows C++ 工具链检测、Hello World 验证、绑定、健康检查和 SQLite 持久化。
- 首次启动环境向导、跳过恢复、固定官方下载入口和受控 WinGet 安装。
- WinGet 安装任务状态、退出码、事件通知、并发限制和成功后自动复检。
- Monaco 多标签编辑、自动保存、外部修改冲突 Diff 和快照恢复。
- GCC、Clang、MSVC 单文件编译运行及标准化诊断。
- CMake、CTest、`compile_commands.json` 和 clang-tidy。
- clangd/LSP 补全、悬停、定义跳转和实时诊断。
- GCC + GDB/MI 单文件断点调试。
- VS Code 新窗口打开和当前文件行列定位。
- 文件栏、快照栏和底部面板拖拽调整及布局持久化。

## 成员 C 接入点

- Renderer 只能使用 `window.cppPet`，不要暴露通用 IPC 或 Node API。
- Agent/MCP 调用本地能力时优先复用现有编译、运行、CMake、CTest、分析和调试契约。
- 文件参数继续使用项目内相对路径，由 Main 通过项目 Root 和 `safePath()` 校验。
- 长任务继续复用超时、取消、输出上限和 Windows 进程树回收。
- Agent Timeline、审批和工具结果可引用现有结构化 `Diagnostic`、`ProcessResult` 和调试状态。

## 验证

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm native:electron
pnpm dev
```

最终基线应满足：

- 33 个单元/契约测试通过。
- 2 个真实 Electron E2E 通过。
- Main、Preload、Renderer 和 Monaco Worker 构建成功。
- `git diff --check` 无错误。

## 尚未完成

- Agent Runtime、MCP Host/Server、模型 Gateway、审批和 Run Timeline。
- 知识树、知识边界、学习画像、错题、成长和成就系统。
- 桌面宠物、截图问答和最终安装包体验。
- 真实 LLVM 环境中的 clangd/clang-tidy 人工补验。
- MSVC/LLDB/DAP、多文件 CMake 调试和高级调试视图。

其余限制和操作注意事项以 `docs/handoff-b/known-issues.md` 为准。
