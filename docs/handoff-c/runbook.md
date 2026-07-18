# H3 运行手册

## 环境

- Windows 10/11
- Node.js 22.18+，推荐当前验证版本 24.11.0
- pnpm 10.24.0（Corepack）
- 至少一个 GCC、Clang 或 MSVC 编译器

项目使用 Node/Electron 内置 `node:sqlite`，不安装 Visual Studio IDE，也不需要 Visual Studio C++ Build Tools 来编译数据库原生模块。

## 安装与启动

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

首次启动按环境向导完成编译器探测、真实 Hello World 验证、工具链绑定和工作区授权。缺失工具只显示官方入口或可恢复提示，不静默安装。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify
git diff --check
```

`pnpm verify` 不再在 Node/Electron ABI 间重建 SQLite。E2E 使用临时 userData 和工作区；结束后自动关闭 Electron。

## 七条演示流程

1. 环境：Agent 模式选择环境，批准绑定，通过真实探测。
2. 项目：输入项目描述，批准创建，查看真实编译验证。
3. 选区：选中代码后询问，Timeline 只显示 selection/diagnostic/learning 来源。
4. 编译错误：制造缺分号错误，批准带 Diff 的 Patch，再批准学习证据。
5. 逻辑错误：提供题目样例，运行反例，批准边界修复，回归后记录错误本。
6. 截图：提交 ScreenshotRef，批准 L3 范围；H3 返回 H4 提供器接入状态。
7. 复习：练习页对到期项选择“通过”或“需巩固”，批准后检查间隔、XP 和勋章。

示例数据见 `demo-data.json`，七条审计记录见 `trace-example.json`。

## 模型设置

- 未配置密钥时七工作流使用确定性离线 Planner。
- Profile 只保存非敏感字段；API Key 由 Main 使用 safeStorage 加密到用户数据目录。
- 启用远程 Profile 后，发送任何上下文前出现 L3 审批；拒绝不会调用模型。
- “测试连接”只发送固定连接测试请求。

## 故障排查

| 现象 | 处理 |
|---|---|
| Agent 显示进程内工具通道 | stdio Worker 握手失败；重启应用并检查 `out/main/mcp-worker.js` |
| 没有 CMake/CTest | 安装 CMake 后重新检测；单文件 GCC 工作流不受影响 |
| 没有 clangd/clang-tidy | 安装 LLVM 后重新检测；基础编辑、编译和 Agent 仍可用 |
| Run 显示 `RUN_INTERRUPTED` | 上次应用退出中断任务；记录只读，不会重放，重新提交即可 |
| 数据库只读恢复 | 检查 `userData/backups` 的迁移前备份和迁移 checksum |
| 在线模型不可用 | 查看 Profile/密钥；Runtime 会记录 fallbackReason 并使用离线 Planner |
