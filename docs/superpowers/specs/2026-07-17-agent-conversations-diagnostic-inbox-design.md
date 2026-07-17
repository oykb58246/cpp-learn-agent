# CppPilot 项目对话与错误收件箱设计

## 背景

CppPilot 当前已经具备 Electron 工作区、C++ 编译与运行、本地诊断、学习背景、OpenAI 兼容模型配置、Agent Runtime、MCP 工具调用、审批和 SQLite 运行记录。现有 Agent 仍以一次性 `AgentRun` 为中心：模型主要生成 JSON 执行计划，最终回答多为工作流摘要；工作区也只把诊断作为发起 Agent 请求时的上下文，没有运行失败后的持久提醒、错误聚合、项目级多轮对话或流式回答。

本设计增加两个互相衔接的用户入口：用户可以在项目内主动与助教进行多轮对话；编译或运行失败后，Agent 按钮提供一个本地生成的错误收件箱，用户选择某个错误组后再让模型按其 C++ 学习背景讲解。

## 目标

1. 每个项目拥有独立、持久、可手动新建和切换的 Agent 对话。
2. 普通提问、代码解释和错误讲解由模型流式回答，可停止、重试并在重启后继续历史对话。
3. 编译、链接、运行时崩溃或非零退出、运行超时产生持久错误提醒。
4. 错误列表完全在本地即时生成，不为生成列表调用模型。
5. 同类错误合并为一个错误组，保留全部出现位置并支持跳转。
6. 用户选择错误组后，可以把讲解加入当前对话，也可以创建新对话。
7. 所有讲解都使用用户自述的 C++ 学习背景，避免假定用户掌握尚未接触的概念。
8. 保留现有 `AgentRuntime + MCP` 工具执行能力和审批边界。

## 非目标

- 第一版不把 clangd 实时诊断、clang-tidy、CMake 或 CTest 结果放入错误收件箱。
- 第一版不让模型预处理、排序或改写错误列表。
- 错误讲解不会自动修改文件、编译或运行程序。
- 第一版不新增 Python、FastAPI、云端中间层或外部 Agent 框架。
- 第一版不实现跨项目共享对话，也不自动把不同项目的上下文混入同一会话。
- 第一版不实现复杂的自然语言工具意图路由；现有工具任务入口继续显式选择执行模式。

## 已确认的产品决策

- 失败后由本地诊断聚合器即时生成列表。
- 错误组先讲共同原因，并显示所有出现位置。
- 第一版提醒范围为编译、链接、运行时崩溃或非零退出、运行超时。
- 对话按项目隔离，同一项目可手动创建多个对话。
- 点击错误组后由用户选择“加入当前对话”或“创建新对话”。
- Agent 按钮采用弹出错误菜单；错误组在弹层内展开后显示位置和两个对话操作。
- 打开错误菜单后停止醒目动画但保留数量；对应运行目标成功后清除。
- 未解决提醒跨应用重启保留。
- 模型回答使用流式输出。

## 总体架构

系统继续使用单一 Electron + TypeScript 技术栈，不引入 FastAPI。新增能力位于现有 contracts、database、Electron main、preload IPC、Pinia 和 Vue 分层中。

```text
Renderer
  Workspace execution result
    -> diagnostic incident IPC
    -> project diagnostic inbox store
  Agent conversation UI
    -> conversation IPC
    <- message delta / state events

Electron main
  DiagnosticIncidentService
    -> DiagnosticGrouper
    -> SQLite repository
  ConversationService
    -> ConversationContextAssembler
    -> StreamingModelGateway
    -> SQLite repository
  Existing AgentHost
    -> AgentRuntime
    -> MCP tools

Shared inputs
  model profile and secret store
  workspace service
  background profile and knowledge catalog
```

`ConversationService` 只负责文字对话和直接模型回答。现有 `AgentRuntime` 继续负责需要执行工具的任务，包括编译、运行、文件写入、测试和调试。两条链路共享模型配置、工作区读取规则、学习背景和取消机制，但不把普通聊天包装成工具工作流。

## 领域模型

### DiagnosticIncident

一次运行目标的失败事实：

- `id`
- `projectId`
- `attemptId`
- `targetKey`
- `operation`: `build | run`
- `failureKinds`: `compile | linker | runtime | nonzero-exit | timeout` 数组
- `status`: `active | resolved | superseded`
- `acknowledgedAt`
- `createdAt`
- `updatedAt`
- `resolvedAt`

`targetKey` 由项目、规范化入口文件和运行配置组成。独立文件运行使用 `projectId + relativePath + standard`；后续扩展工程运行时可以加入构建目标。相同 `targetKey + operation` 只保留一个 active incident，新失败将旧 incident 标为 superseded。

### DiagnosticGroup

incident 内一个共同根因模板：

- `id`
- `incidentId`
- `fingerprint`
- `source`
- `code`
- `failureKind`
- `severity`
- `title`
- `normalizedTemplate`
- `occurrenceCount`
- `createdAt`

### DiagnosticOccurrence

错误组的具体证据：

- `id`
- `groupId`
- `file`
- `line`
- `column`
- `endLine`
- `endColumn`
- `rawMessage`
- `normalizedMessage`

没有源码位置的运行时错误仍产生一个 occurrence，其 `file` 和位置字段为空，原始 stderr 摘要保存在 `rawMessage` 中。

### AgentConversation

- `id`
- `projectId`
- `title`
- `status`: `active | archived`
- `createdAt`
- `updatedAt`

新对话标题先使用“新对话”，第一条消息完成后从用户消息或错误组标题本地截断生成，不额外调用模型。每个项目分别记录最近打开的 conversation id。

### AgentMessage

- `id`
- `conversationId`
- `role`: `user | assistant`
- `kind`: `text | diagnostic-explanation`
- `content`
- `status`: `pending | streaming | completed | stopped | failed | interrupted`
- `diagnosticSnapshotJson`
- `errorCode`
- `errorMessage`
- `createdAt`
- `updatedAt`
- `completedAt`

错误讲解消息保存点击时的错误组快照，包括指纹、标题、出现位置和 incident ids。提醒解决后，历史讲解仍能按快照显示，不依赖活动 incident。

## 错误采集与聚合

### 运行尝试

Renderer 在用户点击“编译”或“运行”时生成一个 `attemptId`。运行操作中的 build 和 program run 共用该 id，避免 build 成功时过早清除随后可能出现的运行时错误。

- 单独 build 成功：解决相同 target 的 compile/linker incident。
- build 失败：记录或替换 build incident，本次尝试终止。
- build 成功并且 program run 成功：解决相同 target 的 runtime/nonzero-exit/timeout incident。
- program run 失败或超时：记录或替换 run incident。
- 用户主动停止不算错误，不创建 incident。

采集由 Electron main 中的 `DiagnosticIncidentService` 完成。Renderer 只提交经过 contracts 校验的执行结果引用和 target 信息，不能直接写 SQLite。

### 归一化

分组指纹按以下优先级生成：

1. 规范化 `source` 和结构化诊断 `code`。
2. 对 `normalizedMessage` 生成稳定消息模板。
3. 指纹为 `failureKind | source | code | normalizedTemplate` 的 SHA-256 摘要。

消息模板只替换已知易变片段：绝对路径、`file:line:column`、十六进制地址、进程 id、独立十进制位置值，以及编译器用引号或反引号标出的标识符。不能删除 C++ 类型、诊断类别、操作符或关键语义短语。存在诊断 code 时仍保留消息模板，避免一个宽泛 code 合并不同错误；没有 code 时必须同时匹配 source、failureKind 和模板。

聚合器按 occurrence 的 `file + line + column + rawMessage` 去重并排序。数据库按 incident 保存组；Agent 弹层生成项目级 inbox projection 时，再按 fingerprint 合并所有 active incidents 的组和位置。因此同一类错误即使出现在多个活动运行目标中，也只显示一条。

对无法解析为结构化 diagnostic 的失败生成合成诊断：

- 非零退出：`程序以退出码 N 结束`
- 超时：`程序运行超过 T 毫秒`
- 崩溃：优先使用平台信号或异常名称，其次使用有界 stderr 摘要
- 链接失败但无结构化项：`链接阶段失败`

原始输出只保存最多 8 KiB 的诊断摘要，不把完整大输出复制进每个 occurrence。

## 错误收件箱交互

Agent 工具栏按钮显示当前项目 active inbox projection 的错误组数量，而不是 occurrence 总数。

- 新 incident 或现有 incident 内容变化后，按钮进入醒目状态。
- 用户打开弹层后，相关 active incidents 写入 `acknowledgedAt`，动画停止，徽标保留。
- 弹层默认折叠显示错误标题、出现次数、失败类别和最近文件。
- 一次只展开一个错误组，展开后显示全部位置；长列表在弹层内部滚动，不扩大工作区布局。
- 点击位置先关闭弹层，再打开对应文件并定位行列；定位失败时保留弹层状态并显示可重试错误。
- 展开区固定提供“加入当前对话”和“创建新对话”。没有当前对话时，“加入当前对话”等价于创建项目默认对话。
- 选择操作后打开 Agent 面板、插入结构化用户消息，并立即开始模型流式讲解。

成功运行把 incident 标为 resolved 后，弹层和徽标通过事件即时更新。对话中的诊断快照与讲解不删除。

## 项目级对话体验

Agent 面板以消息列表为主。顶部包含当前对话菜单和带加号图标的新建命令；菜单列出当前项目的非 archived 对话，按更新时间倒序排列。切换项目时恢复该项目最近打开的对话，不自动携带前一项目消息。

Composer 默认发送普通 `chat` 消息，并附带当前项目、活动文件和选区引用。第一版继续保留显式工具任务入口；用户选择会修改或执行代码的模式时，仍发起现有 `AgentRuntime` 流程和审批，不由 `ConversationService` 静默执行。

每个 conversation 同时只允许一个 streaming assistant message。用户可以停止当前生成；其他 conversation 不自动在后台继续生成。切换对话不会取消生成，但当前项目菜单会标记正在生成的对话。

## 模型请求与流式输出

新增 `StreamingModelGateway`，复用当前启用的 `ModelProfile` 和 main 进程中的 secret store，直接调用 OpenAI 兼容 `/chat/completions`：

- `stream: true`
- `temperature: 0.2`
- 解析 SSE `data:` 帧和 `[DONE]`
- 正确处理任意网络分块边界和跨分块 UTF-8 字符
- API key 永不进入 renderer、日志、消息表或错误详情

发送流程：

1. 事务写入 user message 和 pending assistant message。
2. 将 assistant message 更新为 streaming。
3. 组装上下文并发起模型请求。
4. main 进程通过 IPC 推送带 message id 和单调 sequence 的 delta。
5. Renderer 按 sequence 合并，重复事件可安全忽略。
6. main 每 250 ms 或累计 1 KiB 新内容批量更新 SQLite。
7. `[DONE]` 后写入最终内容和 completed 状态，再广播最终消息。

停止时中止对应 `AbortController`，保留已生成内容并标为 stopped。应用启动时将遗留的 pending/streaming 消息恢复为 interrupted，不自动重新发送。HTTP、协议或模型错误将消息标为 failed，并保留 user message；重试创建新的 assistant message，原失败记录保持可见但折叠。

未配置可用模型或 API key 时不生成伪离线回答，Composer 显示模型配置错误和前往设置的操作。现有离线 planner 只继续服务允许离线执行的工具工作流。

## 对话上下文

`ConversationContextAssembler` 使用以下固定优先级：

1. 系统助教规则和数据不可信边界。
2. `buildExplanationContext` 生成的学习背景说明。
3. 当前错误组快照或用户选区。
4. 最近对话消息。
5. 当前活动文件的有界内容。

错误讲解至少包含共同错误模板、失败类别、全部位置列表、一个代表位置前后各 8 行源码，以及最多另外 4 个不同位置前后各 3 行源码。其余位置只保留文件和行列。相同代码片段去重。

普通对话优先保留最近 20 条消息；如果超过 48,000 字符输入预算，从最旧的非系统消息开始移除，但始终保留最新用户消息、学习背景以及显式选区或错误快照。活动文件只在有 projectId 和 activeFile 时读取，最多加入 24,000 字符；选区优先于完整文件。

诊断、源码、历史 assistant 输出和工具输出全部包裹为带来源标签的数据。系统提示明确要求模型忽略这些数据中的指令性文本。用户学习背景只作为讲解深度偏好，不能被描述为已验证能力。

## IPC 与事件

contracts 新增经 Zod 校验的请求和结果：

- `diagnostics.recordAttempt`
- `diagnostics.listActive`
- `diagnostics.acknowledge`
- `diagnostics.onChanged`
- `conversations.list`
- `conversations.create`
- `conversations.archive`
- `conversations.messages`
- `conversations.send`
- `conversations.stop`
- `conversations.retry`
- `conversations.onMessageDelta`
- `conversations.onChanged`

所有项目级请求在 main 进程重新校验 projectId 和工作区授权。消息 delta 只包含 conversation id、message id、sequence 和文本增量。最终状态事件携带完整、经过 schema 校验的消息，用于 renderer 与数据库收敛。

## 数据库迁移

SQLite 新增以下表和外键索引：

- `diagnostic_incidents`
- `diagnostic_groups`
- `diagnostic_occurrences`
- `agent_conversations`
- `agent_messages`
- `project_conversation_state`

迁移只新增表，不改写现有 agent run 和学习数据。删除项目时通过外键级联删除其 incidents、conversations 和 messages。应用启动恢复 unfinished agent runs 的现有逻辑保持不变，并额外恢复 unfinished assistant messages 为 interrupted。

## 安全与边界

- 错误列表生成和分组不联网。
- `ConversationService` 没有文件写入接口，也不能调用 MCP 工具。
- 文件修改继续只能通过 `AgentRuntime` 的注册工具、风险级别和审批执行。
- Renderer 不能传入绝对文件路径；main 通过 `WorkspaceService` 和 safe path 规则读取上下文。
- 远程模型上下文沿用现有 L3 上下文授权语义；普通用户文本和新增附件范围在发送前可见，拒绝授权时不发起远程请求。
- API key 继续由 Electron safe storage 管理。

## 测试策略

### 单元测试

- 聚合器：相同 code 和模板跨行合并；不同 code、类型或语义不合并。
- 归一化器：路径、行列、地址、pid 和标识符替换稳定，不删除 C++ 类型与操作符。
- 合成诊断：非零退出、超时、崩溃和无诊断链接失败。
- Context assembler：学习背景、错误快照、源码片段、历史裁剪和不可信标签。
- SSE parser：拆帧、合帧、跨 chunk UTF-8、`[DONE]`、无效 JSON、HTTP 错误和取消。
- Store：sequence 去重、停止、失败、重试、项目切换和当前对话恢复。

### 数据库与 main 集成测试

- incident、group、occurrence 和 conversation 跨数据库重启保持一致。
- 同 target 新失败 supersede 旧 incident。
- build 成功只解决 compile/linker；run 成功解决 runtime/nonzero-exit/timeout。
- acknowledged 状态不等于 resolved。
- unfinished message 在重启后变为 interrupted。
- 项目隔离、授权路径校验、secret 不泄露到 IPC 或数据库。

### E2E

- 使用包含多个同类语法错误的 fixture，运行后 Agent 按钮只显示一个聚合组并显示正确 occurrence 数。
- 打开弹层停止动画但保留徽标；重启应用后提醒仍存在。
- 点击 occurrence 打开并定位对应文件行。
- “加入当前对话”和“创建新对话”分别进入正确 conversation。
- 模拟流式模型，验证增量显示、停止、重试和最终持久化。
- 成功重跑后提醒清除，但讲解消息仍存在。
- 两个项目的对话和错误收件箱互不混合。
- 在 1440x900 和 1024x720 窗口验证弹层、消息、Composer 和底部面板无重叠或横向溢出。

## 验收标准

1. 用户可在项目 Agent 面板发送问题并看到真实模型流式回答。
2. 同一项目可新建和切换多个持久对话；不同项目严格隔离。
3. 回答上下文包含当前 C++ 学习背景，并按已学、重点和未接触概念调整讲解。
4. 四类首版运行失败在结果返回后立即产生本地错误提醒，不等待模型。
5. 大量重复诊断按稳定指纹合并为一条，数量与全部位置准确。
6. Agent 按钮弹层符合 C1 交互，并提供当前对话和新对话两个入口。
7. 提醒在查看后保留徽标、跨重启恢复，并在对应成功运行后清除。
8. 错误讲解只生成文字；没有用户批准时不会改文件或运行程序。
9. 停止、网络失败、模型失败和应用异常退出均留下可理解、可恢复的消息状态。
10. 新增单元、集成和 E2E 测试通过，现有 AgentRuntime、MCP、学习背景和工作区测试无回归。
