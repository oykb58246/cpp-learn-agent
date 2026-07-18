# Knowledge Tree Learning Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat knowledge-tree list with an interactive category-lane learning path that exposes prerequisites, parallel concepts, and direct three-state updates.

**Architecture:** Keep the renderer as the presentation layer and reuse the existing `agent.updateKnowledge` action and learning IPC. Add a renderer-only graph projection helper for status labels, prerequisite availability, category lanes, and dependency depth; adjust the runtime transition rules so the existing protocol supports the approved `locked`, `learning`, and `self-claimed` interactions.

**Tech Stack:** Vue 3 Composition API, Pinia, TypeScript, Vitest, Playwright Electron E2E, existing `@cpp-pet/contracts` and `@cpp-pet/agent-runtime` packages.

---

## File Structure

- Modify: `packages/agent-runtime/src/knowledge.ts` - permit manual reset to `locked` and direct user self-claim after prerequisites are active.
- Modify: `packages/agent-runtime/src/knowledge.test.ts` - codify the revised transition rules.
- Create: `apps/desktop/src/renderer/src/utils/knowledge-path.ts` - pure renderer projection of knowledge nodes into statuses, dependency depths, and category lanes.
- Create: `apps/desktop/src/renderer/src/utils/knowledge-path.test.ts` - test the projection without a browser or Pinia.
- Modify: `apps/desktop/src/renderer/src/views/KnowledgeView.vue` - render lanes and node status controls; remove the background-profile dialog path.
- Modify: `apps/desktop/src/renderer/src/styles/app.css` - add contained lane, node, relation, state-control, and narrow-window styles.
- Modify: `tests/e2e/h3.spec.ts` - validate the visible learning-path UI, disabled prerequisites, and an inline state update.

### Task 1: Support the Approved Three-State Transitions

**Files:**
- Modify: `packages/agent-runtime/src/knowledge.test.ts:35-50`
- Modify: `packages/agent-runtime/src/knowledge.ts:168-204`

- [ ] **Step 1: Write failing runtime tests for direct mastery and reset**

Append this test to `packages/agent-runtime/src/knowledge.test.ts`:

```ts
it('allows an eligible concept to be self-claimed directly and reset to locked', () => {
  const prerequisites: LearnerKnowledge[] = [{
    userId: 'local-user', conceptId: 'basics.program', status: 'self-claimed',
    confidence: 0.7, updatedAt: now
  }]

  expect(transitionKnowledge('local-user', builtInKnowledge, prerequisites, 'basics.io', 'self-claimed').status)
    .toBe('self-claimed')
  expect(transitionKnowledge('local-user', builtInKnowledge, prerequisites, 'basics.io', 'locked').status)
    .toBe('locked')
  expect(() => transitionKnowledge('local-user', builtInKnowledge, [], 'basics.io', 'self-claimed'))
    .toThrow('前置概念')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run packages/agent-runtime/src/knowledge.test.ts`

Expected: FAIL because `self-claimed` requires a current `learning` state and `locked` is rejected.

- [ ] **Step 3: Update `transitionKnowledge` without changing the IPC contract**

Replace the status-selection block and return metadata fragment in `packages/agent-runtime/src/knowledge.ts` with:

```ts
if (requestedStatus === 'locked') {
  // Reset is always allowed; it removes the node from the active knowledge boundary.
} else if (requestedStatus === 'learning' || requestedStatus === 'available' || requestedStatus === 'self-claimed') {
  if (missing.length) throw new Error(`请先完成前置概念：${missing.join('、')}`)
} else if (requestedStatus === 'review') {
  if (!current || !['self-claimed', 'verified', 'review'].includes(current.status)) throw new Error('只有已学习或已验证节点可以进入复习。')
} else if (requestedStatus === 'verified') {
  throw new Error('已验证状态必须来自工具或复习证据。')
} else {
  throw new Error('未知的知识状态。')
}

return {
  userId,
  conceptId,
  status: requestedStatus,
  confidence: requestedStatus === 'locked' ? 0 : requestedStatus === 'self-claimed' ? 0.7 : requestedStatus === 'review' ? 0.8 : current?.confidence ?? 0.5,
  ...(requestedStatus !== 'locked' && current?.verifiedAt ? { verifiedAt: current.verifiedAt } : {}),
  ...(requestedStatus !== 'locked' && current?.lastEvidenceId ? { lastEvidenceId: current.lastEvidenceId } : {}),
  updatedAt: now
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run packages/agent-runtime/src/knowledge.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/agent-runtime/src/knowledge.ts packages/agent-runtime/src/knowledge.test.ts
git commit -m "feat: support direct knowledge path states"
```

### Task 2: Add a Testable Knowledge-Path Projection

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/knowledge-path.ts`
- Create: `apps/desktop/src/renderer/src/utils/knowledge-path.test.ts`

- [ ] **Step 1: Write the failing projection tests**

Create `apps/desktop/src/renderer/src/utils/knowledge-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'
import { buildKnowledgeLanes, displayStatusFor } from './knowledge-path'

const now = '2026-07-18T00:00:00.000Z'
const node = (id: string, category: string, prerequisites: string[] = []): KnowledgeNode => ({
  id, title: id, description: id, category, difficulty: 1, prerequisites, tags: []
})

describe('knowledge path projection', () => {
  it('maps review and verified records to the mastered display state', () => {
    expect(displayStatusFor(undefined)).toBe('locked')
    expect(displayStatusFor({ userId: 'local-user', conceptId: 'a', status: 'learning', confidence: .5, updatedAt: now })).toBe('learning')
    expect(displayStatusFor({ userId: 'local-user', conceptId: 'a', status: 'review', confidence: .8, updatedAt: now })).toBe('mastered')
  })

  it('groups same-depth siblings as parallel and identifies blocked prerequisites', () => {
    const catalog = [node('root', '基础'), node('left', '分支', ['root']), node('right', '分支', ['root']), node('finish', '进阶', ['left', 'right'])]
    const knowledge: LearnerKnowledge[] = [{ userId: 'local-user', conceptId: 'root', status: 'self-claimed', confidence: .7, updatedAt: now }]
    const lanes = buildKnowledgeLanes(catalog, knowledge)
    const branch = lanes.find(lane => lane.category === '分支')!
    const finish = lanes.find(lane => lane.category === '进阶')!.rows[0]![0]!

    expect(branch.rows[0]!.map(item => item.node.id)).toEqual(['left', 'right'])
    expect(finish.missingPrerequisiteIds).toEqual(['left', 'right'])
    expect(finish.canAdvance).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/desktop`: `node ../../node_modules/vitest/vitest.mjs run src/renderer/src/utils/knowledge-path.test.ts`

Expected: FAIL because `knowledge-path.ts` does not exist.

- [ ] **Step 3: Implement the pure path helper**

Create `apps/desktop/src/renderer/src/utils/knowledge-path.ts`:

```ts
import type { KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'

export type KnowledgePathStatus = 'locked' | 'learning' | 'mastered'
export interface KnowledgePathNode {
  node: KnowledgeNode
  status: KnowledgePathStatus
  missingPrerequisiteIds: string[]
  depth: number
  canAdvance: boolean
}
export interface KnowledgePathLane { category: string; rows: KnowledgePathNode[][] }

const activeStatuses = new Set<LearnerKnowledge['status']>(['learning', 'self-claimed', 'verified', 'review'])

export function displayStatusFor(state: LearnerKnowledge | undefined): KnowledgePathStatus {
  if (!state || state.status === 'locked' || state.status === 'available') return 'locked'
  return state.status === 'learning' ? 'learning' : 'mastered'
}

export function buildKnowledgeLanes(catalog: KnowledgeNode[], knowledge: LearnerKnowledge[]): KnowledgePathLane[] {
  const byId = new Map(catalog.map(node => [node.id, node]))
  const states = new Map(knowledge.map(state => [state.conceptId, state]))
  const depthCache = new Map<string, number>()
  const depthOf = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!
    const prerequisites = byId.get(id)?.prerequisites ?? []
    const depth = prerequisites.length ? Math.max(...prerequisites.map(depthOf)) + 1 : 0
    depthCache.set(id, depth)
    return depth
  }
  const entries = catalog.map(node => {
    const missingPrerequisiteIds = node.prerequisites.filter(id => !activeStatuses.has(states.get(id)?.status ?? 'locked'))
    return { node, status: displayStatusFor(states.get(node.id)), missingPrerequisiteIds, depth: depthOf(node.id), canAdvance: missingPrerequisiteIds.length === 0 }
  })
  return [...new Set(catalog.map(node => node.category))].map(category => {
    const rows = new Map<number, KnowledgePathNode[]>()
    for (const entry of entries.filter(item => item.node.category === category)) {
      const row = rows.get(entry.depth) ?? []
      row.push(entry)
      rows.set(entry.depth, row)
    }
    return { category, rows: [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row) }
  })
}
```

- [ ] **Step 4: Run helper and store tests**

Run from `apps/desktop`:

```powershell
node ../../node_modules/vitest/vitest.mjs run src/renderer/src/utils/knowledge-path.test.ts src/renderer/src/stores/agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/src/utils/knowledge-path.ts apps/desktop/src/renderer/src/utils/knowledge-path.test.ts
git commit -m "feat: project knowledge graph into learning lanes"
```

### Task 3: Replace the Knowledge View With Direct Node Controls

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/KnowledgeView.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css:969-986,1129`

- [ ] **Step 1: Make the view consume the path projection and remove background editing state**

Use this script setup structure:

```ts
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, CircleDotDashed, CircleGauge } from 'lucide-vue-next'
import type { LearnerKnowledge } from '@cpp-pet/contracts'
import { buildKnowledgeLanes, type KnowledgePathStatus } from '../utils/knowledge-path'
import { useAgentStore } from '../stores/agent'

const store = useAgentStore()
const pendingConceptId = ref<string | null>(null)
const statusOptions: Array<{ value: KnowledgePathStatus; persisted: LearnerKnowledge['status']; label: string }> = [
  { value: 'locked', persisted: 'locked', label: '未学习' },
  { value: 'learning', persisted: 'learning', label: '学习中' },
  { value: 'mastered', persisted: 'self-claimed', label: '已掌握' }
]
onMounted(() => store.refreshAll())
const lanes = computed(() => buildKnowledgeLanes(store.catalog, store.knowledge))
const prerequisiteTitle = (id: string) => store.catalog.find(node => node.id === id)?.title ?? id
const canSelect = (canAdvance: boolean, target: KnowledgePathStatus) => target === 'locked' || canAdvance
const setStatus = async (conceptId: string, status: LearnerKnowledge['status']) => {
  pendingConceptId.value = conceptId
  try { await store.updateKnowledge(conceptId, status) } finally { pendingConceptId.value = null }
}
```

Compute the three summary counts from `lanes`; remove `BackgroundProfileDialog`, `loadBackground`, the `Pencil` import, and all background-derived state.

- [ ] **Step 2: Render category lanes, prerequisite chips, and three fixed state buttons**

Each card must use this structure, including the stable `data-concept-id` test hook:

```vue
<article
  v-for="entry in row"
  :key="entry.node.id"
  class="knowledge-path-node"
  :class="[`status-${entry.status}`, { blocked: !entry.canAdvance }]"
  :data-concept-id="entry.node.id"
>
  <header>
    <component :is="entry.status === 'mastered' ? CheckCircle2 : entry.status === 'learning' ? CircleGauge : CircleDotDashed" :size="16" />
    <div><strong>{{ entry.node.title }}</strong><small>{{ entry.node.description }}</small></div>
    <b>{{ statusOptions.find(option => option.value === entry.status)?.label }}</b>
  </header>
  <p v-if="entry.node.prerequisites.length" class="knowledge-prerequisites">
    前置：<span v-for="id in entry.node.prerequisites" :key="id" :class="{ missing: entry.missingPrerequisiteIds.includes(id) }">{{ prerequisiteTitle(id) }}</span>
  </p>
  <div class="knowledge-status-control" role="group" :aria-label="`${entry.node.title} 掌握状态`">
    <button
      v-for="option in statusOptions"
      :key="option.value"
      type="button"
      :class="{ selected: entry.status === option.value }"
      :disabled="pendingConceptId === entry.node.id || !canSelect(entry.canAdvance, option.value)"
      :aria-pressed="entry.status === option.value"
      :aria-label="`${entry.node.title} ${option.label}`"
      @click="setStatus(entry.node.id, option.persisted)"
    >{{ option.label }}</button>
  </div>
</article>
```

Wrap category sections in `.knowledge-path-scroll > .knowledge-path`. A lane header contains its ordinal, category title, and concept count. Rows come from `lane.rows`, so same-depth siblings are visibly parallel. The summary displays only `未学习`、`学习中`、`已掌握`.

- [ ] **Step 3: Add responsive lane and control styling**

Replace the assistant-specific flat-list rules with styles based on these selectors:

```css
.knowledge-path-scroll { margin-top: 18px; overflow-x: auto; overscroll-behavior-inline: contain; }
.knowledge-path { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(260px, 1fr); gap: 16px; min-width: max-content; padding-bottom: 6px; }
.knowledge-path-lane { min-width: 260px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-subtle); }
.knowledge-path-row { position: relative; display: grid; grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); gap: 8px; margin-top: 14px; }
.knowledge-path-row + .knowledge-path-row::before { content: ''; position: absolute; top: -14px; left: 50%; height: 10px; border-left: 1px solid var(--border-strong); }
.knowledge-path-node { min-width: 0; padding: 10px; border: 1px solid var(--border); border-left: 3px solid var(--text-muted); border-radius: var(--radius-sm); background: var(--panel); }
.knowledge-path-node.status-learning { border-left-color: var(--accent); }
.knowledge-path-node.status-mastered { border-left-color: var(--success); }
.knowledge-status-control { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-top: 9px; }
.knowledge-status-control button { min-width: 0; height: 28px; padding: 0 3px; }
.knowledge-status-control button.selected { border-color: var(--accent); background: var(--panel-subtle); color: var(--accent); }
.knowledge-status-control button:disabled { opacity: .48; cursor: not-allowed; }
```

Keep labels and chips wrapping inside cards. Do not introduce a new global edit action or nested cards.

- [ ] **Step 4: Run renderer checks**

Run from `apps/desktop`:

```powershell
node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json
node ../../node_modules/vitest/vitest.mjs run src/renderer/src/utils/knowledge-path.test.ts src/renderer/src/stores/agent.test.ts
```

Expected: PASS with no Vue template or TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/src/views/KnowledgeView.vue apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: render interactive knowledge learning path"
```

### Task 4: Verify the Learning Path In Electron

**Files:**
- Modify: `tests/e2e/h3.spec.ts:129-137`

- [ ] **Step 1: Extend the knowledge-tree E2E assertions**

Replace the current flat-list assertions with:

```ts
await page.getByRole('link', { name: '知识树' }).click()
await expect(page.getByRole('heading', { name: '知识树' })).toBeVisible()
await expect(page.locator('.knowledge-path')).toBeVisible()
await expect(page.locator('.knowledge-path-lane')).toHaveCount(13)
await expect(page.getByRole('button', { name: '编辑背景' })).toHaveCount(0)
await expect(page.getByText('待复习', { exact: true })).toHaveCount(0)

const blockedArrays = page.locator('[data-concept-id="data.arrays"]')
await expect(blockedArrays.getByRole('button', { name: /数组 学习中/ })).toBeDisabled()
await expect(blockedArrays.locator('.knowledge-prerequisites')).toContainText('循环')

const ioCard = page.locator('[data-concept-id="basics.io"]')
await ioCard.getByRole('button', { name: /标准输入输出 已掌握/ }).click()
await expect(ioCard).toContainText('已掌握')
await captureWindow(electronApp, page, 'h3-knowledge-path-1440x900.png')
```

- [ ] **Step 2: Run E2E test and inspect its screenshot**

Run: `node node_modules/playwright/cli.js test tests/e2e/h3.spec.ts`

Expected: PASS. Inspect `test-results/visual/h3-knowledge-path-1440x900.png` to confirm lanes, prerequisite chips, and controls do not overlap.

- [ ] **Step 3: Run final affected verification**

```powershell
Set-Location apps/desktop
node ../../node_modules/electron-vite/bin/electron-vite.js build
node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.json
Set-Location ../..
node node_modules/vitest/vitest.mjs run packages/agent-runtime/src/knowledge.test.ts apps/desktop/src/renderer/src/utils/knowledge-path.test.ts apps/desktop/src/renderer/src/stores/agent.test.ts
node node_modules/playwright/cli.js test tests/e2e/h3.spec.ts
```

Expected: every command exits with code `0`.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/h3.spec.ts
git commit -m "test: cover knowledge path interactions"
```

