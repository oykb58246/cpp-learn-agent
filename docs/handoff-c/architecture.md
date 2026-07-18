# H3 架构说明

## 交付边界

H3 在 H2 的工作区、编译、运行、测试、分析、调试和 VS Code 能力之上增加可审计教学 Agent。H4 可以通过稳定的 IPC、Run ViewModel 与 PetEvent 接入桌宠、截图提供器、最终视觉和安装器，不需要修改 Agent Runtime。

H3 不包含透明桌宠窗口、托盘、全局快捷键、屏幕区域选择、OCR、最终安装器和最终视觉冻结。

## 运行拓扑

```text
Vue Renderer
  -> sandboxed preload / fixed window.cppPet API
  -> Electron Main
     -> AgentHost
        -> AgentRuntime
           -> DesktopContextBuilder
           -> DesktopPlanner
              -> OpenAI-compatible planner (optional BYOK)
              -> deterministic H3WorkflowPlanner fallback
           -> KnowledgeGate
           -> McpRuntimeToolClient
              -> stdio mcp-worker.js
                 -> DesktopMcpAdapter
                    -> H2 WorkspaceService / ToolchainService / GDB
           -> DatabaseRuntimeStore
     -> AppDatabase / node:sqlite
     -> safeStorage-backed ModelSecretStore
     -> Run changed -> Renderer + PetEvent
```

正常启动使用真实 stdio MCP。握手上限为 5 秒；Worker 异常时主窗口仍先显示，并降级到同一 DesktopMcpAdapter 的进程内 MCP 通道，避免无窗口或灰屏。降级不会绕过工具 Schema、风险级别、工作区边界或验证语义。

## 包职责

| 模块 | 职责 |
|---|---|
| `packages/contracts` | Agent、审批、Timeline、ToolResult、学习域、固定 IPC 与 Preload 类型 |
| `packages/agent-runtime` | 状态机、时限、审批、模型网关、离线计划、知识边界、成长规则和七工作流 |
| `packages/cpp-local-tools` | MCP Server、24 个工具、7 个资源、8 个 Prompt、Progress、Cancellation 和 Timeout |
| `packages/database` | v1-v7 迁移、Run/学习事务、恢复、查询、幂等事件与模型 Profile |
| `apps/desktop/src/main` | Electron Host、stdio Worker、H2 Adapter、safeStorage、IPC 和 PetEvent |
| `apps/desktop/src/renderer` | 工作区 Agent、记录、知识树、练习、报告和模型设置 |

## 状态与持久化

Run 状态为：

```text
queued -> contextualizing -> planning -> policy-check
       -> waiting-approval -> executing -> validating
       -> responding -> completed
       -> failed | cancelled
```

- Run 先落库，再发布 Renderer 事件。
- Run 主记录与步骤表在同一事务中更新。
- 错误本、复习、XP、学习事件和勋章使用可嵌套事务；失败不留下部分状态。
- 重启时非终态 Run 转为 `cancelled/RUN_INTERRUPTED`，审批过期，未完成步骤取消，只追加恢复 Timeline，不重放工具。
- ToolCall、审批、Progress、验证和回答保留为只读审计记录。

## 数据库实现

H3 使用 Electron 43 / Node 24 内置 `node:sqlite`，不再依赖 `better-sqlite3` 原生 ABI，因此开发、测试和 Electron E2E 都不需要 Visual Studio C++ Build Tools。

兼容层位于 `packages/database/src/sqlite.ts`，只封装 Repository 使用的同步 `prepare/run/all/get`、PRAGMA 和可嵌套事务。数据库继续使用 WAL、外键、迁移 checksum、迁移前备份和 quick check。

## H4 接入点

- `window.cppPet.agent.onChanged`：Run 状态流。
- `window.cppPet.pet.onChanged`：等待、执行、成功、失败和升级事件。
- `ScreenshotRef`：H4 截图提供器只需生成已授权引用，不修改 Runtime。
- `AgentRunDetail`：最终视觉可重排 Timeline，不改变领域模型。
- `window.cppPet.learning.*`：知识、错误本、复习和报告数据。
