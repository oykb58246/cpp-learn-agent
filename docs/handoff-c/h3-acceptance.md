# H3 接收清单

## 自动验证

- [x] `pnpm typecheck`：7 个 workspace 类型检查通过。
- [x] `pnpm test`：130 个契约、单元和集成测试通过。
- [x] `pnpm build`：Main、MCP Worker、Preload、Renderer 构建通过。
- [x] H2 两条 Electron E2E 分别通过。
- [x] H3 Electron E2E 通过，包含 1440x900 与 1024x720 视觉、溢出和元素碰撞断言。
- [x] `git diff --check` 无空白错误。

## 规格 1-5：架构、状态机、模型与 MCP

- [x] AgentRequest、ContextPacket、Plan、Run、ToolCall、Approval、Timeline 和学习契约。
- [x] Runtime 最多 12 步、8 工具调用、1 次重试和 120 秒总时限。
- [x] AbortSignal 贯穿模型、MCP 与 H2 长任务；忽略信号的 Promise 仍受 deadline race。
- [x] 应用退出先取消全部 Agent Run，再关闭 MCP/语言/调试会话和数据库。
- [x] OpenAI-compatible Schema 校验、远程 L3 审批和确定性离线 Planner。
- [x] 24 Tools、7 Resources、8 Prompts、Progress、Cancellation、工具 timeout 和 stdio initialize timeout。
- [x] 模型只引用 Registry 工具；Host 重建参数并执行 Zod Schema。

## 规格 6：审批与安全

- [x] L0-L3 风险策略；L2/L3 显式审批。
- [x] 审批显示目的、参数摘要、范围、副作用和 Patch Diff。
- [x] Renderer 只能决策 approvalId，拒绝不执行副作用。
- [x] 路径使用 projectId/Root/safePath；Renderer 无 Node、通用 IPC 或任意工具入口。
- [x] 工具输出标记为不可信模型数据，忽略其中指令。
- [x] API Key 不进入 SQLite、Timeline、日志或 Renderer。

## 规格 7-8：知识、成长与数据

- [x] 38 个无环知识节点、前置闭包与 allow/rewrite/learn。
- [x] 错误本、复习 1/3/7/14/30、通过推进、失败回退和最终完成。
- [x] 可复现证据才产生 XP；sourceEventId 幂等。
- [x] 等级、4 个成长阶段、17 枚确定性勋章和 PetEvent。
- [x] v4-v7 H3 迁移、索引、checksum、迁移备份和重启恢复。
- [x] Run/步骤与学习/XP/勋章原子事务及失败回滚测试。

## 规格 9：七工作流

- [x] 环境：真实检测/探测、绑定审批、环境事件。
- [x] 项目：描述解析、创建审批、真实编译和项目事件。
- [x] 选区：不加载完整文件，保留诊断与学习画像。
- [x] 编译错误：失败证据、Diff Patch、重编译、错误本和 XP。
- [x] 逻辑错误：反例、Patch、回归，失败不标记解决。
- [x] 截图：ScreenshotRef 范围与 L3 审批，返回 H4 接入状态。
- [x] 复习：到期项、通过/失败、知识/间隔/XP/勋章/PetEvent。

七条示例证据见 `trace-example.json`；Windows 真实 adapter 集成测试约 9-13 秒完成。

## 规格 10-11：UI、测试与交接

- [x] 工作区 Agent、审批卡、实时步骤和取消。
- [x] Agent 记录、完整 Timeline、知识树、练习、报告和模型设置。
- [x] loading/empty/error/offline/waiting-approval/cancelled/recovery 状态有对应界面。
- [x] 1024x720 无主容器横向溢出，Agent 证据不与回答区重叠，设置目录不遮挡目标标题。
- [x] 架构、契约、MCP 目录、运行手册、测试报告、已知问题、演示数据和 Trace。

## H4 接收点

- [x] `agent:changed` 和 `pet:changed` 可直接驱动桌宠状态。
- [x] ScreenshotRef 可接系统截图提供器。
- [x] H4 不需要修改 Runtime、Policy、学习规则或数据库内部逻辑。
