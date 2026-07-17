# 助教背景档案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CppPilot 的知识闯关与 Agent 运行审计界面改为基于用户自述背景的 C++ 编程助教体验。

**Architecture:** 保留知识节点图、错误本和 Agent run 存储；新增学习背景档案并将其作为 Agent 的解释策略输入。Renderer 以首次背景咨询、知识树背景地图、首页下一步和助教记录四个表面呈现同一份档案与历史数据，不再读取学习成长、复习或知识门禁结果。

**Tech Stack:** Electron、Vue 3、Pinia、TypeScript、Zod、SQLite、Vitest、Playwright。

---

### Task 1: 建立用户背景档案契约与持久化

**Files:**
- Modify: `packages/contracts/src/learning.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/database/src/h3.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/contracts/src/learning.test.ts`
- Test: `packages/database/src/h3.test.ts`

- [ ] **Step 1: 写失败契约测试**

```ts
expect(backgroundProfileSchema.parse({
  userId: 'local-user', onboardingCompleted: true,
  startingPoint: 'some-experience', studiedConceptIds: ['basics.program'],
  focusConceptIds: ['control.loops'], updatedAt: new Date().toISOString()
}).studiedConceptIds).toEqual(['basics.program'])
expect(backgroundNodeState('data.arrays', nodes, new Set(['basics.program']))).toBe('unseen')
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @cpp-pet/contracts test -- --run src/learning.test.ts`

Expected: FAIL because `backgroundProfileSchema` and `backgroundNodeState` do not exist.

- [ ] **Step 3: 添加最小契约**

```ts
export const backgroundProfileSchema = z.object({
  userId: z.string().min(1).max(100),
  onboardingCompleted: z.boolean(),
  startingPoint: z.enum(['zero-beginner', 'some-experience']),
  studiedConceptIds: z.array(z.string()).max(100),
  focusConceptIds: z.array(z.string()).max(100),
  updatedAt: timestampSchema
})
```

新增 `background_profiles` SQLite 表和 `getBackgroundProfile`、`saveBackgroundProfile`，在 IPC 中暴露 `learning:background:get` 与 `learning:background:save`。保存时去重并过滤未知节点；不覆盖历史 `learner_knowledge` 数据。

- [ ] **Step 4: 运行通过测试**

Run: `corepack pnpm --filter @cpp-pet/contracts test && corepack pnpm --filter @cpp-pet/database test`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/database
git commit -m "feat: persist assistant background profiles"
```

### Task 2: 用解释上下文替换知识门禁

**Files:**
- Modify: `packages/agent-runtime/src/knowledge.ts`
- Modify: `packages/agent-runtime/src/runtime.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/agent-integration.ts`
- Test: `packages/agent-runtime/src/knowledge.test.ts`
- Test: `apps/desktop/src/main/agent-integration.test.ts`

- [ ] **Step 1: 写失败策略测试**

```ts
const context = buildExplanationContext(nodes, profile, ['data.arrays'])
expect(context.knownConceptIds).toContain('basics.program')
expect(context.unseenConceptIds).toContain('data.arrays')
expect(context.instructions).toContain('先简短介绍')
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test -- --run src/knowledge.test.ts`

Expected: FAIL because `buildExplanationContext` does not exist.

- [ ] **Step 3: 实现解释上下文**

```ts
export function buildExplanationContext(nodes, profile, requestedIds) {
  return {
    knownConceptIds: profile.studiedConceptIds,
    focusConceptIds: profile.focusConceptIds,
    unseenConceptIds: requestedIds.filter(id => !profile.studiedConceptIds.includes(id)),
    instructions: [
      'Use known concepts as explanation anchors.',
      'Break down focus concepts with small examples.',
      'Introduce unseen concepts before relying on them.'
    ]
  }
}
```

将 Runtime 的 `KnowledgeGate.check` 调用替换为该上下文注入。Agent 对所有概念都返回 `allow`，不得把请求改写为“先学习前置知识”。保留节点关系仅用于计算 `unseen`。

- [ ] **Step 4: 运行通过测试**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test && corepack pnpm --filter @cpp-pet/desktop test -- --run src/main/agent-integration.test.ts`

Expected: PASS；请求未知概念时没有 blocked 状态。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime apps/desktop/src/main
git commit -m "feat: use background-aware explanation context"
```

### Task 3: 实现首次背景咨询与知识树背景地图

**Files:**
- Create: `apps/desktop/src/renderer/src/components/BackgroundProfileDialog.vue`
- Create: `apps/desktop/src/renderer/src/utils/background-map.ts`
- Modify: `apps/desktop/src/renderer/src/stores/agent.ts`
- Modify: `apps/desktop/src/renderer/src/views/KnowledgeView.vue`
- Modify: `apps/desktop/src/renderer/src/App.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Test: `apps/desktop/src/renderer/src/utils/background-map.test.ts`
- Test: `apps/desktop/src/renderer/src/stores/agent.test.ts`

- [ ] **Step 1: 写失败状态推导测试**

```ts
expect(nodeBackgroundState(nodes, profile, 'basics.program')).toBe('studied')
expect(nodeBackgroundState(nodes, profile, 'control.loops')).toBe('focus')
expect(nodeBackgroundState(nodes, profile, 'data.arrays')).toBe('unseen')
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/utils/background-map.test.ts`

Expected: FAIL because `nodeBackgroundState` does not exist.

- [ ] **Step 3: 实现档案 UI 与状态映射**

首次启动时在应用壳层显示档案对话框。零基础保存空集合；有经验用户显示现有节点树，只允许勾选“学过”“重点解释”。知识树页面顶部显示背景摘要和“编辑我的背景”；按基础到进阶路径渲染 `studied`、`focus`、`unseen`，移除 `locked`、`verified`、`review`、开始学习和已学习按钮。

- [ ] **Step 4: 运行通过测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/utils/background-map.test.ts src/renderer/src/stores/agent.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat: add editable assistant background map"
```

### Task 4: 重做首页为助教入口

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/HomeView.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Test: `apps/desktop/src/renderer/src/views/HomeView.test.ts`

- [ ] **Step 1: 写失败首页测试**

```ts
expect(wrapper.text()).toContain('今天怎么继续')
expect(wrapper.text()).toContain('助教可以帮你做什么')
expect(wrapper.text()).not.toContain('XP')
expect(wrapper.find('[data-testid="open-current-project"]').exists()).toBe(true)
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/views/HomeView.test.ts`

Expected: FAIL because the test id and copy do not exist.

- [ ] **Step 3: 实现首页结构**

用“今天怎么继续”替换学习进度、等级和闯关任务。首要卡片根据最近项目提供“打开项目并继续”，没有项目时提供“新建项目”；第二卡片描述助教能解释代码、分析报错、给出建议；第三卡片展示背景地图摘要和编辑入口。工具链未就绪时保留环境设置入口。

- [ ] **Step 4: 运行通过测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/views/HomeView.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/views/HomeView.vue apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/views/HomeView.test.ts
git commit -m "feat: make home the assistant starting point"
```

### Task 5: 合并为助教记录

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/assistant-records.ts`
- Modify: `apps/desktop/src/renderer/src/views/RunsView.vue`
- Modify: `apps/desktop/src/renderer/src/router/index.ts`
- Modify: `apps/desktop/src/renderer/src/App.vue`
- Delete: `apps/desktop/src/renderer/src/views/PracticeView.vue`
- Delete: `apps/desktop/src/renderer/src/views/ReportsView.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`
- Test: `apps/desktop/src/renderer/src/utils/assistant-records.test.ts`

- [ ] **Step 1: 写失败摘要测试**

```ts
expect(toAssistantRecord(run)).toMatchObject({
  title: '解释：循环边界',
  outcome: expect.any(String),
  nextStep: expect.any(String),
  technicalDetails: expect.any(Array)
})
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/utils/assistant-records.test.ts`

Expected: FAIL because `toAssistantRecord` does not exist.

- [ ] **Step 3: 实现合并记录页面**

将导航项替换为唯一的“助教记录”并移除练习、报告路由。页面合并 `error_book_entries` 和 Agent runs：默认摘要显示问题、结论、关联项目、下一步；展开“技术详情”才显示时间线、审批和工具调用。保留 Composer 作为“向助教提问”入口。旧 `/practice`、`/reports` 路由重定向到 `/runs`。

- [ ] **Step 4: 运行通过测试**

Run: `corepack pnpm --filter @cpp-pet/desktop test -- --run src/renderer/src/utils/assistant-records.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat: merge learning pages into assistant records"
```

### Task 6: 清除成长语义并完成端到端验证

**Files:**
- Modify: `apps/desktop/src/main/agent-integration.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/stores/agent.ts`
- Modify: `tests/e2e/electron.spec.ts`
- Test: `apps/desktop/src/main/agent-integration.test.ts`
- Test: `tests/e2e/electron.spec.ts`

- [ ] **Step 1: 写失败回归测试**

```ts
expect(await page.getByRole('heading', { name: '知识树' })).toContainText('让助教了解你的 C++ 背景')
await expect(page.getByText('XP', { exact: false })).toHaveCount(0)
await page.getByRole('link', { name: '助教记录' }).click()
await expect(page.getByText('历史报错与解决过程')).toBeVisible()
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm test:e2e -- --grep "assistant background"`

Expected: FAIL because current UI exposes learning progress and separate pages.

- [ ] **Step 3: 清除成长副作用并补全迁移**

停止由 Agent 自动写入概念验证、XP、成就和复习队列。保留原表与旧记录，但 UI 和新运行不再读取或写入成长数据。迁移现存 `learner_knowledge` 为背景档案，保证旧用户首次打开不会被空白档案阻塞。

- [ ] **Step 4: 运行完整验证**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm test:e2e`

Expected: all commands exit 0; Playwright covers both first-run profiles, context-aware explanation, background map, homepage actions and merged assistant records.

- [ ] **Step 5: Commit**

```bash
git add apps packages tests
git commit -m "feat: complete assistant background experience"
```
