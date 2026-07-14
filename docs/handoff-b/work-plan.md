# 成员 B 下一步工作计划

## 第 1 批：环境绑定

状态：已完成。

- 工具链共享契约、受限子进程和结构化结果。
- GCC、Clang、MSVC、CMake、调试器、clangd 和 VS Code 探测。
- Hello World 编译运行烟雾验证。
- `ToolchainProfile` SQLite 持久化、健康检查和设置页。
- 固定 C++ 回归样例库。

## 第 2 批：编辑与编译运行

状态：已完成首个可交付版本。

- 用 Monaco Editor 替换基础文本域，复用现有 `FileDocument` 和 `FileRevision`。
- 自动保存、外部修改哈希冲突和 Monaco Diff Editor。
- 单文件编译、运行、停止、超时、输出限制和进程回收。
- GCC、Clang、MSVC 编译与链接诊断标准化。
- 工作区工具栏和输出/问题面板。

验证记录见 `docs/handoff-b/batch-2-test-report.md`。

## 第 3 批：工程、语义与外部联动

状态：下一步。

- CMake configure/build、CTest 和 `compile_commands.json`。
- clangd/LSP 最低可用诊断、补全、悬停和定义跳转。
- clang-tidy 静态分析。
- GDB/LLDB DAP 最低可用调试流程。
- VS Code `-r` 打开项目与 `-g` 定位文件行列。

## H2 冻结

- 工具 Schema、诊断格式、降级规则和安全说明。
- 固定样例全量回归、契约测试和 Electron E2E。
- H2 接收清单、运行手册、测试报告和已知问题。
- 提交 `handoff-b-v1.0`，由成员 C 独立验收。
