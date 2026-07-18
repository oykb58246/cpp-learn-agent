# Beginner Agent Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resumable beginner tour that helps a first-time user understand CppPilot and complete a real offline Agent assistant interaction.

**Architecture:** Persist product-tour progress in the existing JSON-backed `AppSettings`; keep step transitions and viewport placement in testable renderer utilities; use one Pinia store to coordinate the application-level overlay across routes. Existing pages expose stable `data-tour` targets, while `ProductTour.vue` owns focus, target measurement, routing, and fallback presentation.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vue Router, Element Plus, Lucide Vue, Vitest, Playwright Electron.

---

## File Map

- Modify `packages/contracts/src/index.ts`: add persisted product-tour fields to `AppSettings`.
- Modify `packages/database/src/index.ts`: provide defaults and migrate old JSON settings.
- Modify `packages/database/src/database.test.ts`: verify default, migration, and persistence behavior.
- Create `apps/desktop/src/renderer/src/utils/product-tour.ts`: define tour steps, example Agent request, state helpers, and panel placement.
- Create `apps/desktop/src/renderer/src/utils/product-tour.test.ts`: test pure tour state and layout rules.
- Create `apps/desktop/src/renderer/src/stores/product-tour.ts`: coordinate session visibility and persisted progress.
- Create `apps/desktop/src/renderer/src/stores/product-tour.test.ts`: verify Pinia actions and replay semantics.
- Create `apps/desktop/src/renderer/src/components/ProductTour.vue`: render the cross-route coach overlay.
- Create `apps/desktop/src/renderer/src/components/BeginnerQuickStart.vue`: render the home quick-start checklist.
- Modify `apps/desktop/src/renderer/src/components/AgentComposer.vue`: support an explicit, user-selected suggested question.
- Modify `apps/desktop/src/renderer/src/views/HomeView.vue`: mount the quick-start card and mark home targets.
- Modify `apps/desktop/src/renderer/src/views/RunsView.vue`: expose composer/result targets and the beginner suggestion.
- Modify `apps/desktop/src/renderer/src/views/WorkspaceView.vue`: expose workspace Agent targets.
- Modify `apps/desktop/src/renderer/src/App.vue`: mount the tour and add the replay/help entry.
- Modify `apps/desktop/src/renderer/src/stores/app.ts`: include fallback tour settings and make setting failure observable.
- Modify `apps/desktop/src/renderer/src/styles/app.css`: style quick start, mask, focus ring, dialog, and responsive states.
- Create `tests/e2e/beginner-tour.spec.ts`: verify the complete first-use workflow at two window sizes.

## Task 1: Persist Product Tour Settings

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/database/src/database.test.ts`
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: Write failing database tests for defaults, old settings, and persistence**

Add these assertions to `packages/database/src/database.test.ts`:

```ts
it('starts a new user with a pending product tour', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-'))
  dirs.push(dir)
  const db = new AppDatabase(join(dir, 'app.sqlite'))

  expect(db.getSettings()).toMatchObject({
    productTourStatus: 'pending',
    productTourStep: 0,
    productTourWelcomeSeen: false
  })
  db.close()
})

it('migrates old settings and persists product tour progress', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-db-'))
  dirs.push(dir)
  const file = join(dir, 'app.sqlite')
  let db = new AppDatabase(file)
  db.db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?, ?)').run('app', JSON.stringify({
    theme: 'system', sidebarWidth: 260, inspectorWidth: 320, bottomPanelHeight: 190,
    cursorStyle: 'mascot', onboardingCompleted: true, onboardingStatus: 'completed',
    onboardingReminderDismissed: false
  }))
  expect(db.getSettings()).toMatchObject({ productTourStatus: 'pending', productTourStep: 0, productTourWelcomeSeen: false })

  db.updateSettings({ productTourStatus: 'in-progress', productTourStep: 3, productTourWelcomeSeen: true })
  db.close()
  db = new AppDatabase(file)
  expect(db.getSettings()).toMatchObject({ productTourStatus: 'in-progress', productTourStep: 3, productTourWelcomeSeen: true })
  db.close()
})
```

- [ ] **Step 2: Run the focused test and verify the expected type/field failure**

Run:

```powershell
pnpm --filter @cpp-pet/database test -- src/database.test.ts
```

Expected: FAIL because `productTourStatus`, `productTourStep`, and `productTourWelcomeSeen` are absent.

- [ ] **Step 3: Extend the settings contract and database normalization**

Add to `AppSettings` in `packages/contracts/src/index.ts`:

```ts
productTourStatus: 'pending' | 'in-progress' | 'completed' | 'dismissed'
productTourStep: number
productTourWelcomeSeen: boolean
```

In `AppDatabase.getSettings()`, include these new-user defaults:

```ts
productTourStatus: 'pending',
productTourStep: 0,
productTourWelcomeSeen: false
```

Normalize saved JSON before returning it:

```ts
const productTourStatus = saved.productTourStatus === 'in-progress'
  || saved.productTourStatus === 'completed'
  || saved.productTourStatus === 'dismissed'
  ? saved.productTourStatus
  : 'pending'
const productTourStep = Number.isInteger(saved.productTourStep) && Number(saved.productTourStep) >= 0
  ? Number(saved.productTourStep)
  : 0
const productTourWelcomeSeen = saved.productTourWelcomeSeen === true
```

Return the normalized values after `...saved` so invalid persisted values cannot override them.

- [ ] **Step 4: Run database and contracts tests**

Run:

```powershell
pnpm --filter @cpp-pet/database test -- src/database.test.ts
pnpm --filter @cpp-pet/contracts test
```

Expected: PASS.

## Task 2: Implement the Testable Tour Model and Store

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/product-tour.test.ts`
- Create: `apps/desktop/src/renderer/src/utils/product-tour.ts`
- Create: `apps/desktop/src/renderer/src/stores/product-tour.test.ts`
- Create: `apps/desktop/src/renderer/src/stores/product-tour.ts`
- Modify: `apps/desktop/src/renderer/src/stores/app.ts`

- [ ] **Step 1: Write failing tests for step selection and panel placement**

Create `utils/product-tour.test.ts` with concrete expectations:

```ts
import { describe, expect, it } from 'vitest'
import { beginnerTourSteps, panelPlacement, progressForStep } from './product-tour'

describe('product tour model', () => {
  it('covers home, real assistant input, result, and workspace continuation', () => {
    expect(beginnerTourSteps.map(step => step.id)).toEqual([
      'welcome', 'navigation', 'assistant-input', 'assistant-result', 'workspace-agent', 'complete'
    ])
    expect(beginnerTourSteps.find(step => step.id === 'assistant-input')).toMatchObject({ route: '/runs', interactive: true })
  })

  it('reports task progress without counting the completion screen', () => {
    expect(progressForStep(0)).toEqual({ completed: 0, total: 3 })
    expect(progressForStep(3)).toEqual({ completed: 2, total: 3 })
    expect(progressForStep(5)).toEqual({ completed: 3, total: 3 })
  })

  it('keeps the dialog inside a compact viewport', () => {
    expect(panelPlacement({ left: 80, top: 70, right: 380, bottom: 190, width: 300, height: 120 }, { width: 1024, height: 720 }, { width: 360, height: 260 }))
      .toMatchObject({ left: 404, top: 70 })
    expect(panelPlacement(null, { width: 640, height: 480 }, { width: 360, height: 260 }))
      .toMatchObject({ left: 140, top: 110, centered: true })
  })
})
```

- [ ] **Step 2: Run the utility test and verify it fails because the module is absent**

Run:

```powershell
pnpm --filter @cpp-pet/desktop test -- src/renderer/src/utils/product-tour.test.ts
```

Expected: FAIL with module resolution error for `./product-tour`.

- [ ] **Step 3: Implement step definitions and pure helpers**

Create `utils/product-tour.ts` with these public contracts:

```ts
export type ProductTourStepId = 'welcome' | 'navigation' | 'assistant-input' | 'assistant-result' | 'workspace-agent' | 'complete'
export interface ProductTourStep {
  id: ProductTourStepId
  route?: '/home' | '/runs' | '/workspace'
  target?: string
  title: string
  body: string
  interactive?: boolean
}

export const agentTourSuggestion = {
  label: '试着解释这段循环',
  mode: 'explain' as const,
  message: '请用零基础能听懂的方式解释这段代码：\nfor (int i = 0; i < 3; ++i) {\n  std::cout << i << "\\n";\n}'
}

export const beginnerTourSteps: ProductTourStep[] = [
  { id: 'welcome', route: '/home', target: '[data-tour="quick-start"]', title: '五分钟认识 CppPilot', body: '先看清入口，再亲自问助教一个问题。' },
  { id: 'navigation', target: '[data-tour="activity-rail"]', title: '四个主要区域', body: '首页负责开始，工作区处理代码，知识树记录背景，助教记录保留解释过程。' },
  { id: 'assistant-input', route: '/runs', target: '[data-tour="assistant-composer"]', title: '向助教提出第一个问题', body: '选择示例问题，确认内容后由你亲自发送。', interactive: true },
  { id: 'assistant-result', route: '/runs', target: '[data-tour="assistant-result"]', title: '看懂助教结果', body: '先读解释和下一步，需要时再展开处理过程。' },
  { id: 'workspace-agent', route: '/workspace', target: '[data-tour="workspace-agent-toggle"]', title: '在代码旁继续提问', body: '打开项目和文件后，可以让助教解释选区、诊断报错或检查逻辑。' },
  { id: 'complete', title: '已经可以开始了', body: '你已经完成一次真实助教问答，也知道如何回到代码旁继续。' }
]
```

Implement `progressForStep()` with milestones at steps 1, 3, and 5. Implement `panelPlacement()` with a 16 px viewport margin, right/left preference around the target, and centered fallback.

- [ ] **Step 4: Run the utility test and verify it passes**

Run the focused command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing Pinia tests for persisted transitions and replay**

Create `stores/product-tour.test.ts`. Initialize Pinia, seed `useAppStore().bootstrap` with complete `AppSettings`, and mock `window.cppPet.settings.update`. Verify:

```ts
await tour.start()
expect(tour.open).toBe(true)
expect(app.settings).toMatchObject({ productTourStatus: 'in-progress', productTourStep: 0, productTourWelcomeSeen: true })

await tour.goTo(3)
expect(app.settings.productTourStep).toBe(3)
tour.pause()
expect(tour.open).toBe(false)
expect(app.settings.productTourStatus).toBe('in-progress')

await tour.complete()
expect(app.settings.productTourStatus).toBe('completed')
await tour.replay()
expect(tour.replaying).toBe(true)
expect(app.settings.productTourStatus).toBe('completed')
```

Also mock a failed settings response and verify `tour.open === false` and `app.error?.code` is preserved.

- [ ] **Step 6: Run the store test and verify the missing-store failure**

Run:

```powershell
pnpm --filter @cpp-pet/desktop test -- src/renderer/src/stores/product-tour.test.ts
```

Expected: FAIL because `useProductTourStore` is absent.

- [ ] **Step 7: Implement the Pinia store and observable settings update**

Change `app.updateSettings()` to return `Promise<boolean>`: return `true` on an `ok` response and `false` after assigning `this.error` on failure.

Create `stores/product-tour.ts` with state `{ open: false, replaying: false, replayStep: 0, locating: false }`, a `currentStepIndex` getter that returns `replayStep` while replaying and `app.settings.productTourStep` otherwise, and these actions:

```ts
async persist(patch: Partial<AppSettings>) {
  const saved = await useAppStore().updateSettings(patch)
  if (!saved) this.open = false
  return saved
}
async start() {
  this.replaying = false
  this.open = await this.persist({ productTourStatus: 'in-progress', productTourStep: 0, productTourWelcomeSeen: true })
}
async resume() { this.replaying = false; this.open = true }
pause() { this.open = false }
async dismiss() { await this.persist({ productTourStatus: 'dismissed' }); this.open = false }
async goTo(step: number) {
  if (this.replaying) { this.replayStep = step; return }
  this.open = await this.persist({ productTourStep: step })
}
async complete() { if (!this.replaying) await this.persist({ productTourStatus: 'completed', productTourStep: beginnerTourSteps.length - 1 }); this.open = false; this.replaying = false }
async replay() { this.replaying = true; this.open = true; this.replayStep = 0 }
```

- [ ] **Step 8: Run both tour test files**

Run:

```powershell
pnpm --filter @cpp-pet/desktop test -- src/renderer/src/utils/product-tour.test.ts src/renderer/src/stores/product-tour.test.ts
```

Expected: PASS.

## Task 3: Establish the End-to-End Red Test

**Files:**
- Create: `tests/e2e/beginner-tour.spec.ts`

- [ ] **Step 1: Write the complete beginner workflow test before UI implementation**

Launch Electron with the existing seeded environment, update setup settings to completed, and save a zero-beginner background profile. The test must then assert this interaction sequence:

```ts
await expect(page.getByRole('heading', { name: '五分钟上手 CppPilot' })).toBeVisible()
await page.getByRole('button', { name: '开始新手体验' }).click()
await expect(page.getByRole('dialog', { name: '五分钟认识 CppPilot' })).toBeVisible()
await page.getByRole('button', { name: '下一步' }).click()
await page.getByRole('button', { name: '去问助教' }).click()
await expect(page).toHaveURL(/#\/runs$/)
await page.getByRole('button', { name: '试着解释这段循环' }).click()
await expect(page.getByLabel('Agent 模式')).toHaveValue('explain')
await expect(page.getByPlaceholder('向 CppPilot 提交学习任务')).toContainText('for (int i = 0; i < 3; ++i)')
await page.getByRole('button', { name: '发送', exact: true }).click()
await expect(page.locator('[data-tour="assistant-result"]')).toContainText('循环', { timeout: 30_000 })
await page.getByRole('button', { name: '查看回答' }).click()
await page.getByRole('button', { name: '下一步：代码工作区' }).click()
await expect(page).toHaveURL(/#\/workspace/)
await page.getByRole('button', { name: '完成体验' }).click()
```

Verify persisted settings are `completed`, the quick-start card is hidden after returning home, and the `新手帮助` activity-rail button opens replay without changing persisted completion. Pause at step 3, reload, and verify the home card exposes `继续新手体验` before running the completion path.

- [ ] **Step 2: Add visual and overflow checks**

At 1440x900 and 1024x720, capture the welcome, Agent input, Agent result, and workspace steps. Reuse an `expectNoHorizontalOverflow()` helper and also assert every `.product-tour-panel` rectangle remains inside the viewport.

- [ ] **Step 3: Build and run the focused E2E test to prove RED**

Run:

```powershell
pnpm --filter @cpp-pet/desktop build
pnpm exec playwright test tests/e2e/beginner-tour.spec.ts
```

Expected: FAIL at the missing `五分钟上手 CppPilot` heading.

## Task 4: Add the Agent Suggested Question and Result Targets

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.vue`
- Modify: `apps/desktop/src/renderer/src/views/RunsView.vue`

- [ ] **Step 1: Add the optional suggestion contract to AgentComposer**

Extend props and emits:

```ts
suggestion?: { label: string; message: string; mode: AgentStartRequest['mode'] }
// emit addition
'suggestion-selected': []
```

Add a `selectSuggestion()` function that assigns both `mode` and `message`, then emits the event. Render a plain text suggestion button above the existing select/textarea row only when the prop exists. It must never call `submit()`.

- [ ] **Step 2: Connect the suggestion and stable targets in RunsView**

Import `agentTourSuggestion` and `useProductTourStore`. Pass the suggestion only when the tour is open on `assistant-input`. Wrap the composer with `data-tour="assistant-composer"`. Add `data-tour="assistant-result"` to `.run-detail` only when the current run is complete and has a response.

When a submitted run later becomes `completed`, leave navigation advancement to the user-facing `查看回答` button in `ProductTour`; do not auto-skip the result.

- [ ] **Step 3: Run the focused E2E test and verify progress to the next missing UI assertion**

Run the Task 3 build and E2E commands. Expected: the suggestion behavior works after the overlay is implemented; until then, failure remains at the missing tour UI and confirms no false green.

## Task 5: Build the Quick-Start Card and Cross-Route Overlay

**Files:**
- Create: `apps/desktop/src/renderer/src/components/BeginnerQuickStart.vue`
- Create: `apps/desktop/src/renderer/src/components/ProductTour.vue`
- Modify: `apps/desktop/src/renderer/src/views/HomeView.vue`
- Modify: `apps/desktop/src/renderer/src/views/WorkspaceView.vue`
- Modify: `apps/desktop/src/renderer/src/App.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Implement BeginnerQuickStart from persisted state**

The component reads `app.settings.productTourStatus`, `productTourStep`, and `progressForStep()`. Render:

```vue
<section v-if="visible" class="beginner-quick-start" data-tour="quick-start">
  <header>
    <div><Sparkles :size="18" /><span><strong>五分钟上手 CppPilot</strong><small>亲自问一次助教，就知道接下来怎么用</small></span></div>
    <b>{{ progress.completed }} / {{ progress.total }}</b>
  </header>
  <ol>
    <li :class="{ done: progress.completed >= 1 }">认识主要功能区</li>
    <li :class="{ done: progress.completed >= 2 }">向 Agent 助教提问</li>
    <li :class="{ done: progress.completed >= 3 }">在代码旁继续使用</li>
  </ol>
  <footer>
    <button class="primary-command" @click="startOrResume">{{ status === 'in-progress' ? '继续新手体验' : '开始新手体验' }}</button>
    <button class="secondary-command" @click="tour.dismiss">不再提示</button>
  </footer>
</section>
```

Mount it in `HomeView.vue` after environment/recovery banners and before the project command row. Mark the page header or primary action with `data-tour="home-primary"`.

- [ ] **Step 2: Implement ProductTour routing, targeting, and focus**

The application-level component must:

- derive the current step from the tour store, including replay step;
- `router.push(step.route)` before locating a target;
- retry `document.querySelector(step.target)` on animation frames for up to 2 seconds;
- recalculate on `resize`, route change, and step change;
- render four fixed mask segments around the target instead of a clip-path so the focused control can remain interactive;
- use `panelPlacement()` and show a centered fallback when the target is absent;
- focus its heading on open and restore focus to the start/help button on pause or completion;
- handle `Escape` as `tour.pause()`;
- show `返回`, the step-specific next label, `稍后继续`, and `结束引导` actions;
- on `assistant-input`, disable advancement until the real run is completed and label the next action `查看回答`;
- on the workspace step, switch to a no-project explanation when `workspace.projects.length === 0`;
- on completion, offer `完成体验` and `返回首页`.

Use `role="dialog"`, `aria-labelledby`, an `aria-live="polite"` status line, and visible text for all commands.

- [ ] **Step 3: Integrate the application-level entry points**

In `App.vue`:

```vue
<aside ... data-tour="activity-rail">
  <!-- existing navigation -->
  <button class="rail-button" type="button" title="新手帮助" aria-label="新手帮助" @click="tour.replay()">
    <CircleHelp :size="19" /><span class="rail-label">新手帮助</span>
  </button>
</aside>
<main class="app-content"><router-view /></main>
<ProductTour />
```

Do not open the product tour while `/onboarding` is active or while `backgroundDialogVisible` is true. After background save, leave the user on the home card rather than forcibly opening the full overlay. If `productTourWelcomeSeen` is false, render a small dismissible welcome notice in the quick-start component and persist `true` when it is dismissed or the tour starts.

In `WorkspaceView.vue`, add `data-tour="workspace-agent-toggle"` to the existing Agent toolbar button and `data-tour="workspace-agent-panel"` to the panel.

- [ ] **Step 4: Add responsive, restrained styling**

Add styles using existing tokens only:

- `.beginner-quick-start`: full-width section band with a 3-column task row, 1 px border, radius no larger than `var(--radius-md)`.
- `.product-tour-mask-piece`: fixed, `z-index: 110`, translucent neutral black.
- `.product-tour-focus`: fixed 2 px accent outline with 6 px radius and pointer-events none.
- `.product-tour-panel`: fixed width `min(380px, calc(100vw - 32px))`, max-height `calc(100vh - 32px)`, overflow auto, `z-index: 112`.
- At `max-width: 760px`, use a bottom sheet with left/right/bottom 12 px and auto width.
- Under `prefers-reduced-motion: reduce`, remove transitions.

Do not use gradients, decorative orbs, nested cards, or viewport-scaled font sizes.

- [ ] **Step 5: Run typecheck and focused unit tests**

Run:

```powershell
pnpm --filter @cpp-pet/desktop typecheck
pnpm --filter @cpp-pet/desktop test -- src/renderer/src/utils/product-tour.test.ts src/renderer/src/stores/product-tour.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the focused E2E test and fix only observed tour defects**

Run the Task 3 build and E2E commands. Expected: PASS with four new screenshots and no horizontal overflow.

## Task 6: Regression Verification and Completion Audit

**Files:**
- Modify only files implicated by observed failures.

- [ ] **Step 1: Run all workspace typechecks**

Run:

```powershell
pnpm typecheck
```

Expected: all workspace packages exit 0.

- [ ] **Step 2: Run all unit tests**

Run:

```powershell
pnpm test
```

Expected: all Vitest suites pass with zero failed tests.

- [ ] **Step 3: Build the complete workspace**

Run:

```powershell
pnpm build
```

Expected: Electron main, preload, renderer, and all packages build successfully.

- [ ] **Step 4: Run the tour E2E test and relevant existing Electron suites**

Run:

```powershell
pnpm exec playwright test tests/e2e/beginner-tour.spec.ts tests/e2e/electron.spec.ts tests/e2e/h3.spec.ts
```

Expected: all selected Electron tests pass. If an existing assertion uses superseded labels such as `Agent 记录`, update it to the current visible label only after verifying the underlying workflow still runs.

- [ ] **Step 5: Inspect screenshots and canvas-independent layout evidence**

Open the four tour screenshots at both requested window sizes. Confirm:

- the highlighted target matches the explanatory panel;
- the panel never overlaps its target when another side has room;
- all button text fits;
- quick start does not dominate the full first viewport;
- Agent input and response remain visible and usable;
- no onboarding or background dialog is visible beneath the tour.

- [ ] **Step 6: Audit every specification requirement against evidence**

Map requirements to evidence:

```text
Discoverable first-use entry -> Home E2E assertion and welcome screenshot
Real offline Agent question -> completed Agent run and response assertion
Feature overview + Agent + workspace -> six step IDs and route assertions
Skip/resume/replay persistence -> store unit test + E2E reload/settings assertions
No onboarding/background collision -> E2E visibility assertions
1440x900 and 1024x720 layout -> viewport bounds assertions + screenshots
```

Leave the feature incomplete if any row lacks current passing evidence.

## Worktree Safety

The worktree already contains unrelated modifications, including shared renderer files. Do not reset, restore, or overwrite them. Before each edit, inspect the current file and merge the tour changes into that state. Do not stage or commit a shared modified file unless its complete diff has been reviewed and is intentionally part of the user's current work; otherwise report the implementation without creating a mixed commit.
