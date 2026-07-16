# H3 Agent、MCP 与学习成长实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 H2 桌面应用上交付真实 MCP、可审计教学 Agent、七条工作流、知识与成长闭环及 `handoff-c-v1.0` 交接材料。

**Architecture:** 新增纯 TypeScript `agent-runtime` 领域包；`cpp-local-tools` 增加 MCP stdio Server；Electron Main 作为 Host 连接 MCP、数据库和固定 IPC。模型网关采用 OpenAI-compatible BYOK，并由确定性离线规划器保证无密钥可验收。

**Tech Stack:** TypeScript 5.9、Zod 4、MCP TypeScript SDK、Electron 43、Vue 3、Pinia、SQLite/better-sqlite3、Vitest、Playwright。

---

## 文件结构

- `packages/contracts/src/agent.ts`：Agent、MCP、审批、Timeline 契约。
- `packages/contracts/src/learning.ts`：知识、错误本、复习、成长契约。
- `packages/agent-runtime/src/*`：纯领域运行时、策略、模型和工作流。
- `packages/cpp-local-tools/src/mcp/*`：MCP Server、工具、资源和 Prompt 注册。
- `packages/database/src/h3.ts`：H3 SQL 与 Repository 映射。
- `apps/desktop/src/main/agent-host.ts`：Electron 依赖组合、IPC 和事件桥。
- `apps/desktop/src/renderer/src/stores/agent.ts`：Run、审批、知识和报告状态。
- `apps/desktop/src/renderer/src/views/*`：真实 H3 页面。
- `docs/handoff-c/*`：H3 交接材料。

## Task 1：恢复绿色 H2 基线

**Files:**
- Modify: `apps/desktop/src/main/index.ts:648`
- Test: `apps/desktop/src/main/window-options.test.ts`

- [ ] **Step 1: 写失败测试**

抽取 `createWindowOptions(iconPath, iconExists)` 并断言图标不存在时返回对象不含 `icon` 键：

```ts
expect('icon' in createWindowOptions('missing.ico', false)).toBe(false)
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/desktop exec vitest run src/main/window-options.test.ts`
Expected: FAIL，模块或函数尚不存在。

- [ ] **Step 3: 最小实现**

```ts
export function createWindowOptions(iconPath: string, iconExists: boolean): BrowserWindowConstructorOptions {
  return { ...baseOptions, ...(iconExists ? { icon: iconPath } : {}) }
}
```

- [ ] **Step 4: 验证 GREEN**

Run: `corepack pnpm typecheck`
Expected: 所有 workspace 类型检查通过。

- [ ] **Step 5: 提交**

`git commit -m "fix: restore typed desktop window baseline"`

## Task 2：补齐 H3 契约

**Files:**
- Create: `packages/contracts/src/agent.ts`
- Create: `packages/contracts/src/learning.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Test: `packages/contracts/src/agent.test.ts`
- Test: `packages/contracts/src/learning.test.ts`

- [ ] **Step 1: 写 Agent 契约失败测试**

```ts
const parsed = agentRunSchema.parse({
  id: crypto.randomUUID(), requestId: crypto.randomUUID(), mode: 'diagnose',
  status: 'queued', source: 'editor', message: '解释错误', steps: [],
  createdAt: now, updatedAt: now
})
expect(parsed.status).toBe('queued')
expect(agentRunSchema.safeParse({ ...parsed, status: 'unknown' }).success).toBe(false)
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/contracts test`
Expected: FAIL，`agentRunSchema` 未导出。

- [ ] **Step 3: 实现契约**

定义 `ContextSource`、`ContextPacket`、`AgentRunStatus`、`AgentStep`、`ToolDescriptor`、`ToolResult`、`Approval`、`TimelineEvent`、`ModelProfile`、`KnowledgeNode`、`LearnerKnowledge`、`ErrorBookEntry`、`ReviewItem`、`LearningEvent`、`Achievement`、`LearnerSummary` 及对应 Zod Schema。

- [ ] **Step 4: 增加固定 IPC**

增加 `agent:start/get/list/cancel`、`agent:changed`、`approval:decide`、`learning:*`、`model:*`；不增加通用 invoke 或任意工具调用入口。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/contracts test`
Expected: 新旧契约测试全部通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: define H3 agent and learning contracts"`

## Task 3：H3 数据库迁移与 Repository

**Files:**
- Create: `packages/database/src/h3.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/src/h3.test.ts`

- [ ] **Step 1: 写迁移失败测试**

```ts
const db = new AppDatabase(file)
db.createAgentRun(run)
db.appendTimeline(event)
expect(db.getAgentRun(run.id)?.timeline).toHaveLength(1)
db.applyLearningEvent(event)
db.applyLearningEvent(event)
expect(db.getLearnerSummary('local-user').xp).toBe(event.xp)
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/database test -- h3.test.ts`
Expected: FAIL，H3 Repository 方法不存在。

- [ ] **Step 3: 实现迁移 v4-v6**

v4 创建 Run/Step/ToolCall/Approval；v5 创建知识/错误本/复习；v6 创建学习事件/进度/勋章/模型 Profile。所有 SQL 纳入 checksum，事件和奖励以主键幂等。

- [ ] **Step 4: 实现 Repository**

提供 Run 事务写入、Timeline 分页、未完成 Run 恢复、审批决策、知识状态、错误本、到期复习、学习事件幂等和报告聚合。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/database test`
Expected: 迁移、重启持久化、事务回滚和幂等测试通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: persist agent runs and learner progress"`

## Task 4：知识图谱、Knowledge Gate 与成长规则

**Files:**
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/src/knowledge.ts`
- Create: `packages/agent-runtime/src/achievements.ts`
- Create: `packages/agent-runtime/src/fixtures/knowledge.ts`
- Test: `packages/agent-runtime/src/knowledge.test.ts`
- Test: `packages/agent-runtime/src/achievements.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
expect(gate.check(['loops'], profile).decision).toBe('allow')
expect(gate.check(['vector'], profile)).toMatchObject({ decision: 'learn', blocked: ['vector'] })
expect(engine.apply(fixedEvent, emptyProgress).awarded.map(x => x.id)).toContain('first-fix')
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`
Expected: FAIL，新包/实现不存在。

- [ ] **Step 3: 实现知识域**

加入不少于 30 个节点及有向无环前置关系；实现前置闭包、允许概念集合、allow/rewrite/learn 决策和状态转换。

- [ ] **Step 4: 实现成长域**

实现 1/3/7/14/30 天复习调度、XP 幂等规则、等级阈值、4 个成长阶段和至少 15 枚勋章定义。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`
Expected: 知识图无环、边界、复习和奖励测试通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: add knowledge gate and deterministic growth"`

## Task 5：真实 MCP Server 与 Client

**Files:**
- Modify: `packages/cpp-local-tools/package.json`
- Create: `packages/cpp-local-tools/src/mcp/server.ts`
- Create: `packages/cpp-local-tools/src/mcp/registry.ts`
- Create: `packages/cpp-local-tools/src/mcp/resources.ts`
- Create: `packages/cpp-local-tools/src/mcp/prompts.ts`
- Create: `packages/cpp-local-tools/src/mcp/cli.ts`
- Test: `packages/cpp-local-tools/src/mcp/server.test.ts`

- [ ] **Step 1: 写 MCP 契约失败测试**

```ts
const client = await createInMemoryClient(server)
expect((await client.listTools()).tools.map(x => x.name)).toContain('compiler.build')
expect((await client.listPrompts()).prompts).toHaveLength(8)
await expect(client.callTool({ name: 'workspace.read_file', arguments: { projectId, relativePath: '../x' } })).rejects.toThrow()
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/cpp-local-tools test -- mcp/server.test.ts`
Expected: FAIL，MCP Server 不存在。

- [ ] **Step 3: 安装并注册 SDK**

添加 `@modelcontextprotocol/sdk`，使用 stdio transport；通过依赖注入注册现有 H2 services。每个工具声明 input/output Schema、风险、超时和 owner。

- [ ] **Step 4: 实现 Resources/Prompts/Progress/Cancellation**

Resource 读取继续使用 WorkspaceService；长任务将 MCP cancellation 映射到现有 AbortController；进度只发送结构化阶段和百分比。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/cpp-local-tools test`
Expected: H2 回归与 MCP 契约全部通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: expose local C++ capabilities over MCP"`

## Task 6：Agent Runtime、审批和 Timeline

**Files:**
- Create: `packages/agent-runtime/src/runtime.ts`
- Create: `packages/agent-runtime/src/planner.ts`
- Create: `packages/agent-runtime/src/policy.ts`
- Create: `packages/agent-runtime/src/validator.ts`
- Create: `packages/agent-runtime/src/model-gateway.ts`
- Create: `packages/agent-runtime/src/workflows.ts`
- Test: `packages/agent-runtime/src/runtime.test.ts`

- [ ] **Step 1: 写状态机失败测试**

```ts
const run = await runtime.start(request)
expect(run.status).toBe('waiting-approval')
await runtime.decide(run.pendingApproval!.id, 'approved')
await runtime.wait(run.id)
expect(runtime.get(run.id).status).toBe('completed')
expect(runtime.get(run.id).timeline.map(x => x.kind)).toEqual(expect.arrayContaining(['intent','plan','tool','validation']))
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test -- runtime.test.ts`
Expected: FAIL，Runtime 不存在。

- [ ] **Step 3: 实现有限状态机**

实现最大 12 步、8 次工具、1 次重试、120 秒总时限；AbortSignal 贯穿模型和 MCP；每次转换先调用持久化接口再发布事件。

- [ ] **Step 4: 实现模型网关与离线规划器**

OpenAI-compatible 请求只接收 Schema 化计划；离线规划器按七种 mode 生成固定结构但不伪造工具结果。网络/Schema 失败自动降级并记录原因。

- [ ] **Step 5: 实现审批和验证**

L0/L1 按规则自动批准，L2/L3 暂停等待；拒绝不执行工具。Validator 使用真实 build/test 结果判断成功，不用模型自述作为证据。

- [ ] **Step 6: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`
Expected: 完成、拒绝、取消、超时、越界、工具失败、降级和步骤上限测试通过。

- [ ] **Step 7: 提交**

`git commit -m "feat: implement auditable teaching agent runtime"`

## Task 7：七条真实工作流

**Files:**
- Create: `packages/agent-runtime/src/workflows/environment.ts`
- Create: `packages/agent-runtime/src/workflows/project.ts`
- Create: `packages/agent-runtime/src/workflows/explain.ts`
- Create: `packages/agent-runtime/src/workflows/diagnose.ts`
- Create: `packages/agent-runtime/src/workflows/logic.ts`
- Create: `packages/agent-runtime/src/workflows/screenshot.ts`
- Create: `packages/agent-runtime/src/workflows/review.ts`
- Test: `packages/agent-runtime/src/workflows.test.ts`

- [ ] **Step 1: 为七条工作流分别写失败测试**

每条测试断言真实 adapter 调用、适用审批、验证和学习事件；编译/逻辑错误使用 `tests/fixtures-cpp`，截图使用 `ScreenshotRef` provider stub 并断言 L3 审批。

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test -- workflows.test.ts`
Expected: 7 条测试因 workflow 未注册失败。

- [ ] **Step 3: 分别实现工作流**

只组合 Runtime 已有步骤；错误修复必须经过 Patch 审批和重编译，逻辑修复必须回归通过，学习完成必须来自验证证据。

- [ ] **Step 4: 验证 GREEN**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`
Expected: 七条工作流及失败恢复全部通过。

- [ ] **Step 5: 提交**

`git commit -m "feat: complete seven H3 agent workflows"`

## Task 8：Electron Host、Preload 与密钥存储

**Files:**
- Create: `apps/desktop/src/main/agent-host.ts`
- Create: `apps/desktop/src/main/model-secret-store.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/agent-host.test.ts`

- [ ] **Step 1: 写 Host 失败测试**

```ts
expect(await host.start(request)).toMatchObject({ status: 'queued' })
expect(events.at(-1)?.runId).toBe(runId)
expect(secretFileText).not.toContain(apiKey)
```

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm --filter @cpp-pet/desktop exec vitest run src/main/agent-host.test.ts`
Expected: FAIL，Host 不存在。

- [ ] **Step 3: 组合依赖并注册固定 IPC**

Main 创建 Repository、MCP Client、Runtime；sender/schema 校验沿用现有 `handle()`；Run 事件只发送 ViewModel。应用退出取消运行并关闭 MCP 子进程。

- [ ] **Step 4: 实现 safeStorage**

密钥只在 Main 加密保存；Renderer 只能查询 `configured: boolean`、保存新密钥或清除，不能读取明文。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm typecheck && corepack pnpm --filter @cpp-pet/desktop test`
Expected: 类型检查和 Host 测试通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: connect H3 runtime to Electron host"`

## Task 9：H3 Renderer 页面与工作区入口

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/agent.ts`
- Create: `apps/desktop/src/renderer/src/views/RunsView.vue`
- Create: `apps/desktop/src/renderer/src/views/KnowledgeView.vue`
- Create: `apps/desktop/src/renderer/src/views/PracticeView.vue`
- Create: `apps/desktop/src/renderer/src/views/ReportsView.vue`
- Create: `apps/desktop/src/renderer/src/components/AgentComposer.vue`
- Create: `apps/desktop/src/renderer/src/components/ApprovalCard.vue`
- Create: `apps/desktop/src/renderer/src/components/RunTimeline.vue`
- Modify: `apps/desktop/src/renderer/src/router/index.ts`
- Modify: `apps/desktop/src/renderer/src/views/WorkspaceView.vue`
- Modify: `apps/desktop/src/renderer/src/views/SettingsView.vue`
- Test: `tests/e2e/h3.spec.ts`

- [ ] **Step 1: 写 E2E 失败测试**

测试从工作区提交诊断请求，断言审批卡、真实编译工具步骤、验证结论、Run 记录、错误本和 XP 变化。

- [ ] **Step 2: 验证 RED**

Run: `corepack pnpm playwright test tests/e2e/h3.spec.ts`
Expected: FAIL，仍显示 PlaceholderView。

- [ ] **Step 3: 实现 Store 与页面**

订阅 Run 事件并增量更新；页面覆盖 loading、empty、error、offline、approval、cancelled 和 recovery；遵循现有 CppPilot tokens 和紧凑工具界面。

- [ ] **Step 4: 实现工作区与设置入口**

工作区传递 projectId、activeFile、selection 和诊断；设置页保存模型 Profile、测试连接、保存/清除密钥并显示离线模式。

- [ ] **Step 5: 验证 GREEN**

Run: `corepack pnpm typecheck && corepack pnpm build && corepack pnpm playwright test tests/e2e/h3.spec.ts`
Expected: 新页面、审批和 Timeline E2E 通过。

- [ ] **Step 6: 提交**

`git commit -m "feat: deliver H3 agent and learning interface"`

## Task 10：H3 回归、文档与交接

**Files:**
- Create: `docs/handoff-c/architecture.md`
- Create: `docs/handoff-c/contracts.md`
- Create: `docs/handoff-c/mcp-catalog.md`
- Create: `docs/handoff-c/runbook.md`
- Create: `docs/handoff-c/test-report.md`
- Create: `docs/handoff-c/known-issues.md`
- Create: `docs/handoff-c/h3-acceptance.md`
- Create: `docs/handoff-c/trace-example.json`
- Modify: `README.md`

- [ ] **Step 1: 执行需求审计**

逐项映射设计规格第 1、5、7、9、11 节到代码、测试或演示证据；缺少证据的项目返回对应 Task 补齐。

- [ ] **Step 2: 执行全量验证**

Run: `corepack pnpm verify`
Expected: 类型、全部单元/契约、构建和 Electron E2E 通过。

- [ ] **Step 3: 执行安全与降级验证**

验证 Renderer 无 Node/通用 IPC、路径穿越拒绝、工具输出注入隔离、L2/L3 拒绝不产生副作用、无模型离线完成、密钥不出现在数据库/日志/Timeline。

- [ ] **Step 4: 完成交接文档和演示数据**

记录准确测试数量、环境、真实限制、七条 Trace 和成员 D 接入点；README 状态更新为 H3 已完成交接基线、后续进入 H4。

- [ ] **Step 5: 工作区检查**

Run: `git diff --check && git status --short`
Expected: 无空白错误，只有预期 H3 文件。

- [ ] **Step 6: 提交并标记交接基线**

```powershell
git commit -m "feat: finalize member C H3 handoff"
git tag -a handoff-c-v1.0 -m "Member C H3 handoff baseline"
```

