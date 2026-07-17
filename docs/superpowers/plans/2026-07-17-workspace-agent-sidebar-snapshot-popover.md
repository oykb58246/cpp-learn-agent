# Workspace Agent Sidebar and Snapshot Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the workspace Agent conversation into the right sidebar and expose snapshots through an on-demand popover opened from the existing history icon.

**Architecture:** Keep `WorkspaceView` as the owner of workspace and panel state, render the existing `ConversationPanel` inside the optional third grid column, and extract snapshot presentation into a focused `SnapshotPopover`. Reuse the persisted `inspectorWidth` setting and all existing workspace store methods so no IPC or database changes are required.

**Tech Stack:** Vue 3 SFCs, TypeScript, Pinia, lucide-vue-next, CSS grid/container queries, Vitest, Playwright Electron.

---

### Task 1: Add failing workspace layout coverage

**Files:**
- Modify: `tests/e2e/agent-conversations.spec.ts`

- [ ] **Step 1: Add a failing layout and popover test**

Add a focused test after the existing helpers:

```ts
test('places Agent in the right sidebar and opens snapshots on demand', async () => {
  const electronApp = await launch(join(temp, 'workspace-layout-user-data'))
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const prepared = await prepare(page)
    expect(prepared).toHaveProperty('projectId')
    await openProject(page, (prepared as { projectId: string }).projectId)

    await expect(page.locator('.workspace-inspector')).toHaveCount(0)
    await page.getByRole('button', { name: /Agent/ }).click()
    await expect(page.locator('.workspace-agent-inspector .conversation-panel')).toBeVisible()
    await expect(page.locator('.editor-area > .conversation-panel')).toHaveCount(0)

    const history = page.getByRole('button', { name: '快照' })
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)
    await history.click()
    await expect(page.getByRole('dialog', { name: '项目快照' })).toBeVisible()
    await expect(history).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(page.locator('.snapshot-popover')).toHaveCount(0)

    const editorRight = await page.locator('.editor-area').evaluate(element => element.getBoundingClientRect().right)
    const agentLeft = await page.locator('.workspace-agent-inspector').evaluate(element => element.getBoundingClientRect().left)
    expect(Math.abs(editorRight - agentLeft)).toBeLessThanOrEqual(1)
  } finally {
    await electronApp.close()
  }
})
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
pnpm --filter @cpp-pet/desktop build
pnpm exec playwright test tests/e2e/agent-conversations.spec.ts -g "places Agent in the right sidebar"
```

Expected: the test fails because `.workspace-inspector` is initially the snapshot sidebar and `.snapshot-popover` does not exist.

- [ ] **Step 3: Commit the failing test**

```powershell
git add tests/e2e/agent-conversations.spec.ts
git commit -m "test: cover workspace agent sidebar layout"
```

### Task 2: Build the snapshot popover

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SnapshotPopover.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Create the typed popover component**

Implement props and events with the existing contract types:

```ts
const props = defineProps<{
  snapshots: SnapshotManifest[]
  project?: Project | null
}>()
const emit = defineEmits<{
  close: []
  create: [label: string]
  restore: [snapshotId: string]
  remove: [snapshotId: string]
}>()
const label = ref('')

function createSnapshot() {
  emit('create', label.value.trim() || '手动快照')
  label.value = ''
}
```

Register `keydown` and deferred document `pointerdown` listeners on mount. Close only for `Escape` or a pointer target outside the component root; remove both listeners on unmount. Render a `role="dialog"` section with `aria-label="项目快照"`, visible title, close button, create form, snapshot list, restore/delete icon buttons, empty state, and project metadata.

- [ ] **Step 2: Add bounded overlay styles**

Add `.snapshot-popover` rules that position it below `.editor-tabs`, constrain width to `min(340px, calc(100% - 16px))`, constrain height to the editor area, and scroll `.snapshot-list` internally. Reuse existing `.snapshot-create`, `.snapshot-list`, `.project-meta`, `.inspector-empty`, button, border, and theme tokens.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm --filter @cpp-pet/desktop typecheck
```

Expected: PASS with exit code 0.

### Task 3: Move Agent into the optional right column

**Files:**
- Modify: `apps/desktop/src/renderer/src/views/WorkspaceView.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Replace snapshot sidebar state with popover state**

Import `SnapshotPopover`, remove the local `snapshotLabel` and `inspectorOpen`, and add:

```ts
const snapshotOpen = ref(false)
```

Update project switching to set `snapshotOpen.value = false`. Change resize calculations from `inspectorOpen` to `agentOpen` while preserving `inspectorWidth` reads and writes.

- [ ] **Step 2: Render the snapshot trigger and popover**

Replace the history button with:

```vue
<button
  class="icon-command snapshot-toggle"
  :class="{ active: snapshotOpen }"
  title="快照"
  aria-label="快照"
  aria-controls="workspace-snapshot-popover"
  :aria-expanded="snapshotOpen"
  @click.stop="snapshotOpen = !snapshotOpen"
><History :size="16" /></button>
```

Render `SnapshotPopover` inside `.editor-area` with `id="workspace-snapshot-popover"`, pass `store.snapshots` and `store.currentProject`, and connect `create`, `restore`, `remove`, and `close` to the existing store operations.

- [ ] **Step 3: Move `ConversationPanel` after the editor area**

Remove the in-editor `ConversationPanel` block. After `</section>` for `.editor-area`, render the existing inspector resizer only when `agentOpen`, update its accessible text to Agent, then render:

```vue
<aside v-if="agentOpen" class="workspace-inspector workspace-agent-inspector">
  <ConversationPanel
    data-tour="workspace-agent-panel"
    :project-id="store.currentProject?.id"
    :active-file="active?.relativePath"
    :selection="agentSelection"
    :diagnostics="activeDiagnostics"
    :tool-busy="agentRunning || agent.running"
    :tool-status="agent.currentRun?.status"
    @close="agentOpen = false"
    @tool-submit="submitAgent"
    @cancel-tool="agent.currentRun && agent.cancel(agent.currentRun.id)"
  >
    <template v-if="agent.pendingApproval || agent.currentRun" #tool-status>
      <ApprovalCard
        v-if="agent.pendingApproval"
        :approval="agent.pendingApproval"
        :busy="agent.running"
        @decide="decideAgent"
      />
      <div v-else-if="agent.currentRun" class="workspace-agent-evidence">
        <RunTimeline :events="agentTimeline" />
        <p v-if="agent.currentRun.response">{{ agent.currentRun.response }}</p>
      </div>
    </template>
  </ConversationPanel>
</aside>
```

Set `.workspace-view.without-inspector` from `!agentOpen`. Delete the old inline snapshot `<aside>`.

- [ ] **Step 4: Add right-sidebar conversation layout rules**

Add `.workspace-agent-inspector` and descendant rules that make `ConversationPanel` fill the column, remove bottom-panel flex-basis and border assumptions, stack header rows, allow the conversation selector to flex, stack run evidence, and change the composer grid to:

```css
.workspace-agent-inspector .agent-composer {
  grid-template-columns: minmax(0, 1fr) auto;
}
.workspace-agent-inspector .agent-composer > select,
.workspace-agent-inspector .agent-composer > .agent-suggestion {
  grid-column: 1 / -1;
}
```

Keep the transcript as the only flex-growing scroll area and keep the composer fixed at the bottom.

- [ ] **Step 5: Run the focused E2E test and reach green**

Run:

```powershell
pnpm --filter @cpp-pet/desktop build
pnpm exec playwright test tests/e2e/agent-conversations.spec.ts -g "places Agent in the right sidebar"
```

Expected: PASS.

- [ ] **Step 6: Commit the implementation**

```powershell
git add apps/desktop/src/renderer/src/components/SnapshotPopover.vue apps/desktop/src/renderer/src/views/WorkspaceView.vue apps/desktop/src/renderer/src/styles/app.css
git commit -m "feat: move workspace agent into right sidebar"
```

### Task 4: Update snapshot and resize regression coverage

**Files:**
- Modify: `tests/e2e/electron.spec.ts`
- Modify: `tests/e2e/agent-conversations.spec.ts`

- [ ] **Step 1: Update the existing workspace workflow selectors**

Before dragging the right separator in `electron.spec.ts`, open Agent. Replace assumptions that `.workspace-inspector` contains snapshots with `.workspace-agent-inspector`, open the snapshot popover before counting `.snapshot-list article`, and assert the popover stays within `.editor-area`.

- [ ] **Step 2: Cover all close paths and narrow layout**

Extend the focused layout test to assert trigger toggle, close button, outside pointer click, and `Escape`. At 1024x720 assert document width does not overflow and verify:

```ts
const overlap = await page.evaluate(() => {
  const editor = document.querySelector('.editor-area')!.getBoundingClientRect()
  const agent = document.querySelector('.workspace-agent-inspector')!.getBoundingClientRect()
  const popover = document.querySelector('.snapshot-popover')!.getBoundingClientRect()
  return {
    editorAgent: editor.right > agent.left + 1,
    popoverAgent: popover.right > agent.left + 1
  }
})
expect(overlap).toEqual({ editorAgent: false, popoverAgent: false })
```

Capture `workspace-agent-sidebar-1440x900.png` and `workspace-agent-sidebar-1024x720.png` in `test-results/visual`.

- [ ] **Step 3: Run targeted regression tests**

Run:

```powershell
pnpm --filter @cpp-pet/desktop test
pnpm --filter @cpp-pet/desktop build
pnpm exec playwright test tests/e2e/agent-conversations.spec.ts tests/e2e/electron.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 4: Run full verification**

Run:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 5: Inspect screenshots and DOM geometry**

Open both new screenshots and confirm the Agent is the right column, snapshots are a compact overlay in the editor, the bottom panel remains unobstructed, text fits, and no control overlaps. Re-run the focused E2E test after any visual correction.

- [ ] **Step 6: Commit regression coverage and visual corrections**

```powershell
git add tests/e2e/electron.spec.ts tests/e2e/agent-conversations.spec.ts apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/renderer/src/views/WorkspaceView.vue apps/desktop/src/renderer/src/components/SnapshotPopover.vue
git commit -m "test: verify workspace panel placement"
```
