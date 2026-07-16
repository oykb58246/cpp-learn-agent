# H3 契约说明

## Renderer 边界

- Renderer 只访问 `window.cppPet`，没有 Node、Electron、MCP Client 或通用 IPC。
- Main 对每个固定 IPC 输入执行 Zod 校验，并拒绝非主窗口 sender。
- Renderer 只能提交已有 `approvalId` 的批准/拒绝决策，不能改写工具名或参数。
- API Key 只能保存、清除和查询 `apiKeyConfigured`，明文不返回 Renderer。

## Agent 契约

| 类型 | 关键字段与约束 |
|---|---|
| `AgentStartRequest` | 固定 source/mode；消息、选区、诊断、ScreenshotRef 有界；复习必须含 item 和 outcome |
| `ContextPacket` | 来源标签、trusted、tokenEstimate、truncated 和 conceptIds |
| `AgentRun` | 有限状态、最多 12 步、pendingApproval、回答、验证和错误 |
| `ToolCall` | server/tool/risk、裁剪参数、结构化结果、耗时和错误码 |
| `Approval` | 工具、目的、风险、参数摘要、副作用、可选 100 KB Diff 和决策状态 |
| `TimelineEvent` | sequence、kind、status、摘要、stepId 和结构化 evidence |
| `ScreenshotRef` | 已授权预览、MIME、尺寸和创建时间；H3 不负责采集像素 |
| `ModelProfile` | baseUrl、model、enabled、timeout 和 `apiKeyConfigured`，不含密钥 |

运行限制默认为 12 个步骤、8 次工具调用、每工具最多重试 1 次、总时限 120 秒。ContextBuilder、Planner 和忽略 AbortSignal 的工具 Promise 都受总时限约束。

## 学习契约

| 类型 | 说明 |
|---|---|
| `KnowledgeNode` | 38 个内置节点，包含前置、难度、分类与标签 |
| `LearnerKnowledge` | locked/available/learning/self-claimed/verified/review |
| `ErrorBookEntry` | 类别、最小证据、文件、概念、次数、状态和复习时间 |
| `ReviewItem` | 1/3/7/14/30 天 intervalIndex、到期、完成状态 |
| `LearningEvent` | 稳定 sourceEventId、可复现 evidence、事件 XP |
| `LearnerSummary` | XP、等级、4 阶段、知识/错误/复习聚合、勋章和近期事件 |

同一 sourceEventId 只奖励一次。聊天次数和模型文本不产生 XP。`verified` 复习更新必须引用 pending ReviewItem 且 outcome 为 `passed`。

## 固定 IPC

| 组 | 方法 |
|---|---|
| Agent | `agent:start/get/list/cancel`、`agent:changed` |
| Approval | `approval:decide` |
| Learning | `learning:catalog/knowledge/update-knowledge/errors/reviews/summary` |
| Model | `model:list/save/remove/clear-key/test` |
| Pet | `pet:changed` |

H1/H2 的 app、settings、workspace、project、files、snapshots、toolchains、compiler、program、CMake、CTest、analysis、language、debug 和 VS Code IPC 保持兼容。

## 错误语义

真实工具失败映射到失败 ToolResult，例如 `BUILD_FAILED`、`PROGRAM_RUN_FAILED`、`CMAKE_BUILD_FAILED`、`CTEST_FAILED`、`ANALYSIS_FAILED`、`TEST_CASES_FAILED`。修复前反例可以声明 `continueOnFailure`，修复后验证失败会终止 Run，不能写入“已解决”。
