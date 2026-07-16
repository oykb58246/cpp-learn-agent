# H3 Agent、MCP 与学习成长设计

## 1. 目标与边界

H3 在 H2 的真实工作区、编译、运行、测试、分析、调试和 VS Code 能力之上，交付可审计的教学型 Agent 业务闭环。完成后，成员 D 可以仅通过稳定的 ViewModel、IPC 和事件接口完成桌宠与最终视觉，不需要修改 Agent 内部逻辑。

H3 必须交付：

- AgentRequest、ContextPacket、AgentPlan、AgentRun、ToolCall、Approval 和学习域契约。
- Intent Router、Context Builder、Planner、Execution Loop、Validator、Knowledge Gate、Policy、Memory 和 Timeline。
- 真实 MCP stdio Server、Client Manager、Tools、Resources、Prompts、Progress 和 Cancellation。
- OpenAI-compatible 模型网关和无密钥可运行的确定性离线规划器。
- 环境、项目创建、选区解释、编译错误、逻辑错误、截图上下文和复习成长七条工作流。
- 知识树、学习画像、错误本、复习调度、报告、XP、等级、勋章和 PetEvent。
- Agent 记录、知识树、练习和报告真实页面，以及工作区 Agent 入口。
- H3 自动化、演示数据、运行手册、契约、已知问题和接收清单。

H3 不实现透明桌宠窗口、系统托盘、全局快捷键、屏幕区域选择器、OCR、最终安装器和最终视觉冻结。这些属于 H4。H3 仍需实现截图引用、预览元数据、审批与多模态请求契约，使 D 可以接入系统截图能力。

## 2. 架构

```text
Vue Renderer
  -> window.cppPet.agent / learning / approvals
Sandboxed Preload
  -> typed IPC and events
Electron Main (Host)
  -> AgentRuntime
     -> ModelGateway (OpenAI-compatible or deterministic offline)
     -> KnowledgeGate / PolicyEngine / Validator
     -> McpClientManager
        -> stdio -> cpp-local-tools MCP Server
  -> AppDatabase (runs, learning, achievements)
  -> Run event stream -> Renderer and future pet window
```

`packages/agent-runtime` 是纯 TypeScript 领域包，不依赖 Electron、Vue 或 SQLite。外部能力通过接口注入，因此可以在 Vitest 中使用真实确定性适配器验证状态机。

`packages/cpp-local-tools` 保留现有 H2 服务，同时新增 MCP stdio 入口和注册器。MCP handler 调用既有 ToolchainService、受限进程、诊断、LSP 和调试实现，不重复命令拼接逻辑。

Electron Main 是 MCP Host 和持久化编排层。Renderer 仍只访问固定 `window.cppPet` 方法，不暴露 MCP Client、任意工具名、任意 IPC 或 Node API。

## 3. Agent 状态机

每个 Run 遵循以下有限状态：

```text
queued -> contextualizing -> planning -> policy-check
       -> waiting-approval -> executing -> validating
       -> responding -> completed
       -> failed | cancelled
```

约束：

- 默认最多 12 个计划步骤、8 次工具调用、每工具最多重试 1 次、总时限 120 秒。
- 协议错误、越权、用户拒绝、知识超界且拒绝学习、不可重试工具错误立即停止或重规划。
- Run 创建后先落库；每次状态变化、步骤、审批、工具结果和验证结论均追加记录。
- 恢复时只恢复未完成 Run 的可读 Timeline，不自动重放写入或执行操作。
- Cancellation 使用 `AbortSignal` 贯穿模型、MCP Client 和 H2 长任务。

## 4. 模型网关

设置包含 `baseUrl`、`model`、超时和是否启用；API Key 通过 Electron `safeStorage` 加密后保存到用户数据目录，不写 SQLite、日志、Timeline 或 Renderer 状态。

网关使用 OpenAI-compatible Chat Completions/Responses 风格的 JSON 请求，输出必须经过 Zod Schema 校验。模型不可用、未配置或输出无效时，确定性规划器按请求模式生成受限计划，七条工作流仍可调用真实 MCP 工具并完成验证。

模型只能提出已注册工具调用。Host 根据 Tool Registry 重建参数并执行 Schema 校验，绝不直接执行模型生成的命令、路径或 URL。

## 5. MCP 能力

### Tools

- `toolchain.detect_compilers`、`toolchain.probe_compiler`、`toolchain.bind_compiler`
- `workspace.list_files`、`workspace.read_file`、`workspace.create_file`、`workspace.apply_patch`、`workspace.create_snapshot`
- `compiler.build`、`program.run`、`program.stop`
- `cmake.build`、`ctest.run`、`analysis.clang_tidy`
- `debug.start`、`debug.command`
- `problem.parse`、`tests.generate_cases`、`tests.run_cases`
- `vscode.open_file`、`learning.get_state`、`learning.update_state`

工具统一返回 `ToolResult`，包含 summary、structuredContent、diagnostics、artifacts、sideEffects、retryable、errorCode 和 durationMs。过长 stdout/stderr 在进入模型上下文前裁剪，原始结果仍以本地审计记录引用保存。

### Resources

- `cpplearn://project/{id}/tree`
- `cpplearn://project/{id}/files/{path}`
- `cpplearn://project/{id}/diagnostics/latest`
- `cpplearn://project/{id}/problem`
- `cpplearn://learner/{id}/knowledge-state`
- `cpplearn://learner/{id}/error-book`
- `cpplearn://run/{id}`

### Prompts

提供策划案中的八个教学 Prompt 模板。Prompt 只描述教学结构和输出 Schema，不包含 API Key、本机绝对路径或超出 Knowledge Gate 的概念。

## 6. 审批与安全

风险分级：

- L0：只读资源和纯解析，自动批准。
- L1：受限编译、分析、快照，受信任工作区自动批准并记录。
- L2：写文件、运行程序、调试、绑定工具链、学习状态变更，需要显式批准或当前会话授权。
- L3：删除、恢复、截图、远程发送敏感上下文，每次显式批准，不可记住。

审批卡显示工具、目的、参数摘要、文件/数据范围、风险、预期副作用和可选 Diff。Renderer 只能批准已存在的 approvalId，不能修改工具参数。拒绝后记录原因并由 Planner 调整或结束。

工具输出视为不可信数据。模型上下文使用来源标签隔离，忽略工具输出中的指令性文本。所有文件仍由 Main 使用 projectId、项目 Root 和 `safePath()` 解析。

## 7. 知识与成长域

内置至少 30 个有前置关系的 C++ 知识节点，状态为 locked、available、learning、self-claimed、verified、review。Knowledge Gate 计算前置闭包，允许使用 verified、自我声明且已解锁、当前学习中的概念；计划或回答使用越界概念时返回允许、改写或建议学习节点。

学习事件必须来自可复现证据：编译成功、测试通过、错误修复验证、复习答题、用户明确完成节点。聊天次数和模型文本不产生 XP。

错误本保存错误类别、最小证据、相关文件/诊断、概念、首次/最近出现时间、解决状态和下次复习时间。复习采用 1、3、7、14、30 天间隔，根据验证结果推进或回退。

成长系统至少包含 15 枚确定性勋章和 4 个成长阶段。XP 由事件规则计算，等级与成长阶段由固定阈值派生；同一 sourceEventId 幂等处理。

## 8. 数据模型

在现有迁移后增加：

- `agent_runs`：请求、意图、状态、计划摘要、响应、验证、时间和错误。
- `agent_steps`：序号、类型、状态、工具名、开始/结束时间和摘要。
- `tool_calls`：Server、工具、参数摘要、风险、结果、耗时和错误。
- `approvals`：风险、展示内容、状态、决策和时间。
- `knowledge_nodes`、`knowledge_edges`、`learner_knowledge`。
- `error_book_entries`、`review_items`、`learning_events`。
- `learner_progress`、`achievement_definitions`、`learner_achievements`。
- `model_profiles`：不含密钥的模型设置。

所有运行与学习写入使用事务。Timeline 查询使用 runId 和时间索引；学习事件以 eventId 唯一约束保证奖励幂等。

## 9. 七条工作流验收

1. 环境：调用真实检测/探测，审批绑定，验证 Hello World，记录环境成就。
2. 项目：解析题目/描述，检查知识边界，审批文件计划，创建并编译项目。
3. 选区：最小上下文只包含选区、相邻符号、诊断和学习画像，输出受 Knowledge Gate 约束。
4. 编译错误：真实编译、定位首个根因、审批 Patch、重编译验证、写入错误本。
5. 逻辑错误：真实构建/测试，产生最小失败用例，必要时调试，回归通过后才标记解决。
6. 截图上下文：接收已授权 ScreenshotRef，展示外发范围并审批；无截图提供器时给出可恢复的 H4 接入状态。
7. 复习成长：从到期错误生成练习，验证完成后更新知识、复习间隔、XP、勋章和 PetEvent。

每条工作流的 E2E/集成测试必须断言 Timeline 中存在意图、上下文来源、计划、真实工具、审批（适用时）、验证和学习事件。

## 10. UI

- 工作区新增 Agent 输入区、选区询问、诊断请求、审批卡和实时步骤摘要。
- Agent 记录页展示 Run 列表、状态过滤和完整 Timeline。
- 知识树页展示前置关系、状态、进度和学习入口。
- 练习页展示到期复习、错误本来源和验证结果。
- 报告页展示已验证知识、错误趋势、XP、等级、勋章和最近学习事件。
- 设置页提供模型 Profile、连接测试、密钥保存/清除和离线模式状态。

页面遵循现有 CppPilot 设计系统，不新增独立视觉语言。所有页面提供 loading、empty、error、offline、waiting-approval、cancelled 和 recovery 状态。

## 11. 测试与交接

- 契约：Schema 默认值、非法工具参数、Timeline 和审批状态。
- MCP：Tools/Resources/Prompts 列举、调用、错误、进度、取消和超时。
- Runtime：正常完成、审批拒绝、知识越界、工具失败、模型降级、步骤/重试/时限。
- 数据库：迁移、事务、幂等奖励、Run 恢复和查询。
- 学习域：前置闭包、状态转换、复习间隔、XP、等级和 15 枚勋章。
- 集成：七条工作流使用真实 H2 adapter，不允许固定成功文本替代工具结果。
- Electron E2E：Agent 请求、审批、Timeline、知识变化、错误本和成长反馈。

交付 `handoff-c-v1.0`、H3 架构、契约、MCP 目录、运行手册、测试报告、已知问题、接收清单、演示数据和 Trace 示例。

