# H1 已知边界

以下内容是明确的阶段边界，不应被描述为已完成能力：

1. 基础文本编辑器尚未使用 Monaco，不提供语义补全、诊断、Diff Editor 或 LSP。
2. VS Code、GCC、Clang、MSVC、CMake、clangd、clang-tidy 和 DAP 状态均为契约 Mock。
3. Agent、MCP、知识树、学习报告和 Timeline 为结构化 Mock，未连接模型或真实工具。
4. 目前仅编辑 UTF-8/UTF-8 BOM 文本，超出 2 MiB 或二进制文件只读。
5. 自动保存未启用；成员 B 接 Monaco 时应复用 `FileRevision.expectedHash` 和快照策略实现。
6. 搜索为受限本地扫描，最多 5000 个文件、200 条结果；大型工程可由 B 评估 ripgrep 索引。
7. Electron Renderer 仍整体引入 Element Plus，生产 JS/CSS 体积偏大；D 可在界面冻结后做按需导入优化。
8. `electron-builder` 在含空格路径下可能显示 node-gyp 历史警告；当前环境实测原生模块重建和 E2E 可运行。
9. H1 的恢复模式是应用层只读：旧 Schema 保持可查询，写 API 被拒绝；尚未提供图形化数据库文件替换向导。
10. 最终安装器、代码签名、自动更新和卸载数据策略留给 D。

发现前序缺陷时，B 应保留复现步骤并交由 A 修复，不应在 Monaco 或工具链模块中绕过工作区核心。
