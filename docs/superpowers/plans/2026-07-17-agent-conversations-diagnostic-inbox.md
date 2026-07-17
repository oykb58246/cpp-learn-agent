# Agent Conversations and Diagnostic Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent project conversations with streamed model answers and a persistent, locally grouped diagnostic inbox opened from the workspace Agent button.

**Architecture:** Electron main owns diagnostic recording, grouping, conversation orchestration, model secrets, streaming, and SQLite persistence. The renderer consumes validated IPC contracts through preload, keeps project-scoped Pinia state, and renders a compact diagnostic popover plus a project conversation panel. Existing `AgentRuntime + MCP` remains the only path that may execute tools or write files.

**Tech Stack:** TypeScript 5.9, Electron 43, Vue 3, Pinia, Zod 4, Node `node:sqlite`, OpenAI-compatible SSE, Vitest, Playwright.

---

## File Map

- Create `packages/contracts/src/conversation.ts`: diagnostic inbox, conversation, message, streaming event, and IPC request schemas.
- Modify `packages/contracts/src/index.ts`: export new contracts and add `CppPetApi.diagnostics` / `CppPetApi.conversations`.
- Modify `packages/contracts/src/ipc.ts`: add channel constants.
- Create `packages/agent-runtime/src/diagnostic-grouper.ts`: deterministic normalization, fingerprinting, synthetic runtime diagnostics, and project inbox projection.
- Create `packages/agent-runtime/src/diagnostic-grouper.test.ts`: grouping boundary tests.
- Create `packages/agent-runtime/src/streaming-model-gateway.ts`: OpenAI-compatible SSE parser and streamed completion client.
- Create `packages/agent-runtime/src/streaming-model-gateway.test.ts`: chunking, UTF-8, cancellation, and HTTP failure tests.
- Create `packages/agent-runtime/src/conversation-context.ts`: bounded prompt assembly using background profile, selection, error snapshot, history, and active file.
- Create `packages/agent-runtime/src/conversation-context.test.ts`: pedagogy and truncation tests.
- Modify `packages/agent-runtime/src/index.ts`: export the new runtime units.
- Modify `packages/database/src/h3.ts`: add schema migration 9.
- Modify `packages/database/src/index.ts`: incident and conversation repositories plus interrupted-message recovery.
- Create `packages/database/src/conversation.test.ts`: restart, supersede, resolve, project isolation, and interrupted recovery tests.
- Create `apps/desktop/src/main/diagnostic-incident-service.ts`: record trusted build/run results and publish inbox changes.
- Create `apps/desktop/src/main/diagnostic-incident-service.test.ts`: service lifecycle tests.
- Create `apps/desktop/src/main/conversation-service.ts`: persist messages, assemble context, stream, stop, retry, and publish events.
- Create `apps/desktop/src/main/conversation-service.test.ts`: service state-machine tests with a fake gateway.
- Modify `apps/desktop/src/main/index.ts`: instantiate services, hook build/run results, register IPC, and shut down active streams.
- Modify `apps/desktop/src/preload/index.ts`: expose validated diagnostics and conversations APIs.
- Modify `apps/desktop/src/renderer/src/stores/agent.ts`: project inbox, conversations, messages, deltas, send/stop/retry actions.
- Modify `apps/desktop/src/renderer/src/stores/agent.test.ts`: delta dedupe and project-scoped state tests.
- Create `apps/desktop/src/renderer/src/components/DiagnosticInboxPopover.vue`: C1 grouped error popover.
- Create `apps/desktop/src/renderer/src/components/ConversationPanel.vue`: conversation switcher, message list, streaming states, and composer integration.
- Modify `apps/desktop/src/renderer/src/components/AgentComposer.vue`: default conversation submit and stop behavior while retaining explicit tool modes.
- Modify `apps/desktop/src/renderer/src/views/WorkspaceView.vue`: connect execution, inbox badge/popover, source navigation, and conversation panel.
- Modify `apps/desktop/src/renderer/src/styles/app.css`: stable popover/panel dimensions and responsive behavior.
- Create `tests/fixtures-cpp/duplicate-syntax-errors/main.cpp`: repeated compiler errors.
- Create `tests/e2e/agent-conversations.spec.ts`: end-to-end inbox and streaming conversation coverage.

### Task 1: Add Shared Contracts

**Files:**
- Create: `packages/contracts/src/conversation.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add assertions that parse one active diagnostic incident with a grouped occurrence, one project conversation, a streaming assistant message, and a monotonically sequenced delta. Add rejection assertions for absolute occurrence paths, a blank message, an invalid message transition, and a delta longer than 20,000 characters.

- [ ] **Step 2: Run the contracts test and confirm missing exports**

Run: `pnpm --filter @cpp-pet/contracts test -- contracts.test.ts`

Expected: FAIL because `diagnosticIncidentSchema`, `agentConversationSchema`, `agentMessageSchema`, and `conversationMessageDeltaSchema` are not exported.

- [ ] **Step 3: Implement the schemas**

Define these public types with Zod:

```ts
export type DiagnosticFailureKind = 'compile' | 'linker' | 'runtime' | 'nonzero-exit' | 'timeout'
export type DiagnosticIncidentStatus = 'active' | 'resolved' | 'superseded'
export type AgentMessageStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'failed' | 'interrupted'

export interface DiagnosticInboxGroup {
  fingerprint: string
  title: string
  source: Diagnostic['source']
  code?: string
  failureKind: DiagnosticFailureKind
  severity: Diagnostic['severity']
  occurrenceCount: number
  occurrences: DiagnosticOccurrence[]
  incidentIds: string[]
}

export interface ConversationSendInput {
  conversationId: string
  message: string
  activeFile?: string
  selection?: AgentEditorSelection
  diagnostic?: DiagnosticExplanationSnapshot
}
```

Use UUIDs for stored ids, relative-path strings capped at 1,024 characters, message content capped at 100,000 characters, and ISO timestamps. `conversationMessageDeltaSchema` contains `conversationId`, `messageId`, nonnegative `sequence`, and a 20,000-character `delta`.

- [ ] **Step 4: Add IPC channels and API surface**

Add `diagnosticsListActive`, `diagnosticsAcknowledge`, `diagnosticsChanged`, `conversationsList`, `conversationsCreate`, `conversationsArchive`, `conversationsMessages`, `conversationsSend`, `conversationsStop`, `conversationsRetry`, `conversationMessageDelta`, and `conversationsChanged`. Add matching `CppPetApi` methods returning `ApiResult` and listener unsubscribe functions.

- [ ] **Step 5: Verify contracts**

Run: `pnpm --filter @cpp-pet/contracts test && pnpm --filter @cpp-pet/contracts typecheck`

Expected: all contract tests and typecheck PASS.

### Task 2: Implement Deterministic Diagnostic Grouping

**Files:**
- Create: `packages/agent-runtime/src/diagnostic-grouper.ts`
- Create: `packages/agent-runtime/src/diagnostic-grouper.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Write failing grouping tests**

Cover GCC and MSVC messages where paths, line numbers, addresses, pids, and quoted identifiers differ. Assert equal fingerprints only when `failureKind`, `source`, `code`, and normalized template agree. Assert duplicate occurrences are removed and different C++ types or operators remain separate.

- [ ] **Step 2: Confirm the tests fail**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- diagnostic-grouper.test.ts`

Expected: FAIL because the grouper module does not exist.

- [ ] **Step 3: Implement normalization and fingerprints**

Export:

```ts
export function normalizeDiagnosticTemplate(message: string): string
export function diagnosticFingerprint(kind: DiagnosticFailureKind, diagnostic: Diagnostic): string
export function groupDiagnostics(incidentId: string, kind: DiagnosticFailureKind, diagnostics: Diagnostic[]): StoredDiagnosticGroup[]
export function syntheticRuntimeDiagnostics(process: ProcessResult): Array<{ kind: DiagnosticFailureKind; diagnostic: Diagnostic }>
export function projectInboxProjection(incidents: DiagnosticIncidentDetail[]): DiagnosticInboxGroup[]
```

Normalize line endings and whitespace, then replace Windows/POSIX absolute paths, `:line:column`, hex addresses, pid phrases, and quoted identifiers. Hash the joined fingerprint input with SHA-256. Dedupe occurrences by normalized relative path, line, column, and raw message; sort by file, line, and column.

- [ ] **Step 4: Verify grouping**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- diagnostic-grouper.test.ts && pnpm --filter @cpp-pet/agent-runtime typecheck`

Expected: all grouper tests and runtime typecheck PASS.

### Task 3: Persist Incidents and Conversations

**Files:**
- Modify: `packages/database/src/h3.ts`
- Modify: `packages/database/src/index.ts`
- Create: `packages/database/src/conversation.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Create a temporary database, insert an active incident with two groups and three occurrences, create two project conversations and streamed messages, close/reopen, and assert exact recovery. Assert a new incident supersedes the previous active row for the same `targetKey + operation`; resolution only affects the requested failure kinds; project queries never return another project's data; startup changes pending/streaming messages to interrupted.

- [ ] **Step 2: Confirm migration and repository methods are missing**

Run: `pnpm --filter @cpp-pet/database test -- conversation.test.ts`

Expected: FAIL on missing repository methods and tables.

- [ ] **Step 3: Add migration 9**

Create tables `diagnostic_incidents`, `diagnostic_groups`, `diagnostic_occurrences`, `agent_conversations`, `agent_messages`, and `project_conversation_state`. Use foreign keys with `ON DELETE CASCADE`, indexes on project/status/update time, and a partial unique index allowing one active incident per `project_id, target_key, operation`.

- [ ] **Step 4: Add transactional repository methods**

Implement:

```ts
saveDiagnosticIncident(detail: DiagnosticIncidentDetail): DiagnosticIncidentDetail
listActiveDiagnosticIncidents(projectId: string): DiagnosticIncidentDetail[]
acknowledgeDiagnosticIncidents(projectId: string, ids: string[], at: string): void
resolveDiagnosticIncidents(projectId: string, targetKey: string, kinds: DiagnosticFailureKind[], at: string): void
createConversation(conversation: AgentConversation): AgentConversation
listConversations(projectId: string): AgentConversation[]
archiveConversation(projectId: string, conversationId: string): AgentConversation
saveAgentMessage(message: AgentMessage): AgentMessage
listAgentMessages(projectId: string, conversationId: string): AgentMessage[]
setCurrentConversation(projectId: string, conversationId: string): void
getCurrentConversationId(projectId: string): string | undefined
recoverInterruptedMessages(at: string): number
```

Use transactions when replacing incident groups/occurrences and when creating paired user/assistant messages.

- [ ] **Step 5: Verify database behavior**

Run: `pnpm --filter @cpp-pet/database test && pnpm --filter @cpp-pet/database typecheck`

Expected: all database tests and typecheck PASS.

### Task 4: Record Trusted Build and Run Failures

**Files:**
- Create: `apps/desktop/src/main/diagnostic-incident-service.ts`
- Create: `apps/desktop/src/main/diagnostic-incident-service.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write failing service lifecycle tests**

Use a fake repository and change listener. Assert build diagnostics produce compile/linker groups, cancelled processes do nothing, successful build resolves only build kinds, failed run creates runtime/nonzero-exit/timeout groups, successful run resolves only run kinds, and changes publish the updated project inbox.

- [ ] **Step 2: Confirm the service is missing**

Run: `pnpm --filter @cpp-pet/desktop test -- diagnostic-incident-service.test.ts`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement `DiagnosticIncidentService`**

The constructor receives `AppDatabase` and a clock. Public methods are:

```ts
recordBuild(input: BuildRequest, result: BuildResult): DiagnosticInboxGroup[]
recordRun(target: { projectId: string; relativePath: string; standard: CppStandard }, result: ProgramRunResult): DiagnosticInboxGroup[]
list(projectId: string): DiagnosticInboxGroup[]
acknowledge(projectId: string): DiagnosticInboxGroup[]
onChanged(listener: (event: DiagnosticInboxChangedEvent) => void): () => void
```

Build artifacts in main must retain `relativePath` and `standard`, so the run handler can resolve the trusted target without renderer input.

- [ ] **Step 4: Hook the service into existing handlers**

After trusted compiler and runtime results are constructed, call `recordBuild` or `recordRun`. Do not record cancelled processes. Register list/acknowledge IPC and publish `diagnosticsChanged` to renderer.

- [ ] **Step 5: Verify incident integration**

Run: `pnpm --filter @cpp-pet/desktop test -- diagnostic-incident-service.test.ts && pnpm --filter @cpp-pet/desktop typecheck`

Expected: lifecycle tests and desktop typecheck PASS.

### Task 5: Implement Streaming Model Gateway

**Files:**
- Create: `packages/agent-runtime/src/streaming-model-gateway.ts`
- Create: `packages/agent-runtime/src/streaming-model-gateway.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Write failing SSE tests**

Build mocked `ReadableStream<Uint8Array>` responses that split JSON fields, SSE blank lines, and a Chinese UTF-8 character across chunks. Assert ordered text deltas, `[DONE]` completion, HTTP error text, malformed payload failure, timeout, and caller cancellation.

- [ ] **Step 2: Confirm the gateway is missing**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- streaming-model-gateway.test.ts`

Expected: FAIL because `StreamingModelGateway` is not exported.

- [ ] **Step 3: Implement the parser and gateway**

Expose:

```ts
export interface StreamingCompletionInput {
  profile: ModelProfile
  apiKey: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export class StreamingModelGateway {
  constructor(fetcher: typeof fetch = fetch)
  stream(input: StreamingCompletionInput, signal: AbortSignal, onDelta: (delta: string) => void | Promise<void>): Promise<void>
}
```

Use `TextDecoder` in streaming mode, buffer until SSE frame boundaries, parse only `data:` lines, accept `choices[0].delta.content` strings, and combine caller and timeout signals with `AbortSignal.any`.

- [ ] **Step 4: Verify gateway behavior**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- streaming-model-gateway.test.ts && pnpm --filter @cpp-pet/agent-runtime typecheck`

Expected: all gateway tests and typecheck PASS.

### Task 6: Assemble Pedagogical Conversation Context

**Files:**
- Create: `packages/agent-runtime/src/conversation-context.ts`
- Create: `packages/agent-runtime/src/conversation-context.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Write failing context tests**

Assert that zero-beginner, studied, focus, and unseen concept instructions are present; diagnostic content is labeled as untrusted data; representative source snippets use ±8 lines and four additional ±3-line snippets; recent history is preserved newest-first under the 48,000-character budget; selection replaces full-file context.

- [ ] **Step 2: Confirm the assembler is missing**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- conversation-context.test.ts`

Expected: FAIL because `assembleConversationMessages` is missing.

- [ ] **Step 3: Implement bounded assembly**

Export a pure function accepting background profile, knowledge nodes, stored messages, current user message, optional selection, optional active file content, and optional diagnostic snapshot. Return OpenAI role/content messages. Always retain system rules, learning instructions, diagnostic/selection data, and newest user message; trim oldest history first.

- [ ] **Step 4: Verify pedagogy and bounds**

Run: `pnpm --filter @cpp-pet/agent-runtime test -- conversation-context.test.ts && pnpm --filter @cpp-pet/agent-runtime typecheck`

Expected: context tests and typecheck PASS.

### Task 7: Orchestrate Persistent Conversations

**Files:**
- Create: `apps/desktop/src/main/conversation-service.ts`
- Create: `apps/desktop/src/main/conversation-service.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write failing service tests**

With fake database, workspace reader, gateway, secrets, and listeners, assert project validation, automatic default conversation creation, paired message persistence, ordered delta publication, 250 ms/1 KiB batching, completion, stop, retry, model-not-configured failure, and one active stream per conversation.

- [ ] **Step 2: Confirm the service is missing**

Run: `pnpm --filter @cpp-pet/desktop test -- conversation-service.test.ts`

Expected: FAIL because `ConversationService` does not exist.

- [ ] **Step 3: Implement the state machine**

`ConversationService` owns `Map<conversationId, AbortController>`, resolves the enabled profile and secret inside main, validates project ownership, reads active files through `WorkspaceService`, calls the context assembler and gateway, persists state transitions, and emits delta/final events. `stop` marks partial content stopped; `retry` only accepts failed/stopped/interrupted assistant messages and creates a new assistant attempt for the same preceding user message.

- [ ] **Step 4: Register conversation IPC**

Wire list/create/archive/messages/send/stop/retry and both event channels. On application startup call interrupted recovery; on shutdown abort every active conversation before closing SQLite.

- [ ] **Step 5: Verify orchestration**

Run: `pnpm --filter @cpp-pet/desktop test -- conversation-service.test.ts && pnpm --filter @cpp-pet/desktop typecheck`

Expected: service tests and desktop typecheck PASS.

### Task 8: Expose APIs and Build Project-Scoped Store

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/stores/agent.ts`
- Modify: `apps/desktop/src/renderer/src/stores/agent.test.ts`

- [ ] **Step 1: Write failing store tests**

Assert project load fetches active inbox/conversations/current messages, a new conversation becomes current, an ordered delta appends once, duplicate/out-of-order deltas are ignored, final events replace optimistic state, project switches clear previous project state, and stop/retry call the correct API.

- [ ] **Step 2: Confirm store tests fail**

Run: `pnpm --filter @cpp-pet/desktop test -- agent.test.ts`

Expected: FAIL because conversation and inbox state/actions are absent.

- [ ] **Step 3: Expose preload methods and listeners**

Mirror every new `CppPetApi` method. Listener wrappers must remove the exact wrapped callback and type payloads with `Parameters<typeof listener>[0]`.

- [ ] **Step 4: Implement store state and actions**

Add `inbox`, `conversations`, `currentConversationId`, `messages`, `messageSequences`, `conversationLoading`, and unsubscribe handles. Keep existing AgentRun state/actions for tool workflows. Add `loadProjectAgent`, `createConversation`, `selectConversation`, `sendMessage`, `stopMessage`, `retryMessage`, `acknowledgeInbox`, and event handlers.

- [ ] **Step 5: Verify store and preload**

Run: `pnpm --filter @cpp-pet/desktop test -- agent.test.ts && pnpm --filter @cpp-pet/desktop typecheck`

Expected: store tests and typecheck PASS.

### Task 9: Build the Diagnostic Popover and Conversation Panel

**Files:**
- Create: `apps/desktop/src/renderer/src/components/DiagnosticInboxPopover.vue`
- Create: `apps/desktop/src/renderer/src/components/ConversationPanel.vue`
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.vue`
- Modify: `apps/desktop/src/renderer/src/views/WorkspaceView.vue`
- Modify: `apps/desktop/src/renderer/src/styles/app.css`

- [ ] **Step 1: Add component behavior tests where practical**

Extend renderer tests for local helpers that compute badge labels, choose an expanded group, create diagnostic snapshots, and preserve stable message ordering. Keep DOM behavior for Playwright because this repository does not currently include Vue Test Utils.

- [ ] **Step 2: Implement the C1 popover**

Use a button-anchored popover with one expanded group at a time. Show group count, title, category, all scrollable occurrences, occurrence navigation, “加入当前对话”, and “创建新对话”. Opening emits acknowledge; action emits a complete diagnostic snapshot and routing choice.

- [ ] **Step 3: Implement project conversations**

`ConversationPanel` renders a compact conversation menu, icon-only new-conversation command with tooltip, message list, streaming/stopped/failed/interrupted states, retry command, and `AgentComposer`. Do not nest cards; messages use an unframed transcript layout. Keep explicit tool modes available through the existing mode control.

- [ ] **Step 4: Integrate workspace behavior**

The Agent toolbar button shows grouped badge count and a new-error attention class. Clicking with active inbox opens the popover; clicking without inbox toggles the panel. Occurrence clicks call existing `showLocation`. Diagnostic routing opens the panel, creates/selects the requested conversation, and sends the explanation snapshot. Project mount/switch loads and subscribes to project Agent state.

- [ ] **Step 5: Add stable responsive CSS**

Constrain popover width to `min(360px, calc(100vw - 24px))`, max-height to the available editor viewport, and occurrence list overflow. Preserve the existing workspace grid and ensure the transcript/composer cannot force horizontal overflow at 1024x720.

- [ ] **Step 6: Verify renderer build**

Run: `pnpm --filter @cpp-pet/desktop test && pnpm --filter @cpp-pet/desktop typecheck && pnpm --filter @cpp-pet/desktop build`

Expected: all desktop tests, typecheck, and Electron build PASS.

### Task 10: Add End-to-End Coverage and Complete Verification

**Files:**
- Create: `tests/fixtures-cpp/duplicate-syntax-errors/main.cpp`
- Create: `tests/e2e/agent-conversations.spec.ts`
- Modify: `tests/e2e/electron-env.ts`

- [ ] **Step 1: Add deterministic streaming model fixture**

Start a local HTTP fixture in the E2E process that accepts `/chat/completions`, emits multiple SSE chunks containing Chinese teaching text, and terminates with `[DONE]`. Configure the app's model profile and secret through the existing test setup without external network access.

- [ ] **Step 2: Write the diagnostic inbox scenario**

Import the duplicate-error fixture, run it, assert one grouped error with the correct occurrence count, open/acknowledge without clearing the badge, restart Electron and assert persistence, navigate to an occurrence, route to a new conversation, observe streamed teaching text, rerun successfully, and assert the badge clears while messages remain.

- [ ] **Step 3: Write project isolation and stop/retry scenarios**

Create two projects, assert conversations and inboxes do not cross project boundaries, stop a streaming response and assert partial content/state, then retry and assert a completed replacement response.

- [ ] **Step 4: Capture and inspect desktop layouts**

Capture 1440x900 and 1024x720 screenshots. Assert no horizontal document overflow and no overlap among the popover, Agent panel, message transcript, Composer, editor toolbar, and bottom panel.

- [ ] **Step 5: Run focused E2E**

Run: `pnpm --filter @cpp-pet/desktop build && pnpm exec playwright test tests/e2e/agent-conversations.spec.ts`

Expected: the new E2E file PASS at both window sizes.

- [ ] **Step 6: Run the full verification suite**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`

Expected: every workspace typecheck, unit/integration test, build, and E2E test PASS.

- [ ] **Step 7: Audit the specification requirement by requirement**

Map all ten acceptance criteria in `docs/superpowers/specs/2026-07-17-agent-conversations-diagnostic-inbox-design.md` to passing contract, unit, database, main integration, renderer, and E2E evidence. Do not mark completion while any criterion lacks direct evidence.
