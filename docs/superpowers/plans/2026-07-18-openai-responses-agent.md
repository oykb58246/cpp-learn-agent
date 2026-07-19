# OpenAI Responses Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local natural-language routing and static offline workflows with an OpenAI Responses API Agent that executes validated MCP function calls in a bounded evidence loop.

**Architecture:** Add versioned context, tool-output, and final-response contracts; generate OpenAI strict function tools from the MCP Zod registry; implement an OpenAI Responses client and a new runtime controller that persists approvals and observations. Route every workspace Agent prompt through this controller, while keeping deterministic toolbar commands local and retaining legacy run fields only for historical compatibility.

**Tech Stack:** TypeScript, Zod 4 JSON Schema conversion, OpenAI Responses HTTP API, MCP stdio, Electron, Vue/Pinia, Vitest, Playwright.

---

### Task 1: Versioned Agent Contracts

**Files:**
- Create: `packages/contracts/src/openai-agent.ts`
- Modify: `packages/contracts/src/agent.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/openai-agent.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover `cpppilot.context.v1`, `cpppilot.tool-output.v1`, and `cpppilot.final.v1`; reject unknown fields, invalid task IDs, missing clarification text, and unsupported final statuses. Add run-state tests for `waiting-model-approval`, `model-requesting`, `validating-model-output`, and `waiting-input`.

- [ ] **Step 2: Verify the tests fail**

Run: `corepack pnpm --filter @cpp-pet/contracts test`

Expected: imports or new status assertions fail because the contracts do not exist.

- [ ] **Step 3: Implement strict Zod contracts**

Export schemas and inferred types for:

```ts
cppPilotContextEnvelopeSchema
cppPilotToolOutputSchema
cppPilotFinalResponseSchema
openAiFunctionToolSchema
openAiResponseOutputItemSchema
```

Extend `agentRunStatusSchema` with the four model-loop states and add an optional bounded `pendingClarification` object to `AgentRun`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `corepack pnpm --filter @cpp-pet/contracts test && corepack pnpm --filter @cpp-pet/contracts typecheck`

Expected: all contract tests and typecheck pass.

### Task 2: MCP Registry to OpenAI Functions

**Files:**
- Create: `packages/cpp-local-tools/src/mcp/openai-tools.ts`
- Modify: `packages/cpp-local-tools/src/mcp/index.ts`
- Test: `packages/cpp-local-tools/src/mcp/openai-tools.test.ts`

- [ ] **Step 1: Write failing registry conversion tests**

Assert that all `localToolDefinitions` produce unique underscore aliases, `strict: true`, object parameters, `additionalProperties: false`, and required properties. Verify alias round-trip, local Zod revalidation, default handling, relative-path rejection, and inclusion of the three learning tools.

- [ ] **Step 2: Verify the tests fail**

Run: `corepack pnpm --filter @cpp-pet/cpp-local-tools test`

Expected: the OpenAI tool-registry module is missing.

- [ ] **Step 3: Implement `createOpenAiToolRegistry`**

Use `z.toJSONSchema()` as the starting point, remove unsupported metadata such as defaults and formats, recursively close objects, and make optional values nullable and required for OpenAI strict mode. Return this runtime surface:

```ts
interface OpenAiToolRegistry {
  tools: OpenAiFunctionTool[]
  resolve(functionName: string): LocalToolDefinition | undefined
  parse(functionName: string, args: unknown): {
    definition: LocalToolDefinition
    arguments: Record<string, unknown>
  }
}
```

Strip null optional values before the original Zod parse so defaults remain local and authoritative.

- [ ] **Step 4: Run tool tests and typecheck**

Run: `corepack pnpm --filter @cpp-pet/cpp-local-tools test && corepack pnpm --filter @cpp-pet/cpp-local-tools typecheck`

Expected: all conversion, MCP, and local-tool tests pass.

### Task 3: OpenAI Responses Client and Global Instructions

**Files:**
- Create: `packages/agent-runtime/src/openai-instructions.ts`
- Create: `packages/agent-runtime/src/responses-client.ts`
- Create: `packages/agent-runtime/src/responses-client.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Write failing Responses serialization tests**

Use a fake fetcher to assert `/responses`, Authorization handling, `store: false`, global instructions, structured context input, strict tools, final `text.format`, and continuation input containing original output items plus `function_call_output`. Add refusal, incomplete, HTTP error, timeout, malformed item, and secret-leak tests.

- [ ] **Step 2: Verify the tests fail**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`

Expected: the Responses client and instructions exports are missing.

- [ ] **Step 3: Implement the client**

Create a typed client whose only endpoint is:

```ts
`${profile.baseUrl.replace(/\/$/, '')}/responses`
```

It accepts a locally managed input-item array and returns validated OpenAI output items. It never calls `/chat/completions`, never logs the API key, and maps API failures to typed model errors.

- [ ] **Step 4: Implement versioned global instructions**

Encode the twelve normative rules from the design in one exported constant. Include the rule that punctuation mistakes, incomplete quotes, and minor typos are interpreted by the model rather than repaired locally.

- [ ] **Step 5: Run client tests and typecheck**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test && corepack pnpm --filter @cpp-pet/agent-runtime typecheck`

Expected: all Responses client tests pass.

### Task 4: Bounded OpenAI Agent Runtime

**Files:**
- Create: `packages/agent-runtime/src/openai-runtime.ts`
- Create: `packages/agent-runtime/src/openai-runtime.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/desktop/src/main/agent-host.ts`
- Test: `apps/desktop/src/main/agent-host.test.ts`

- [ ] **Step 1: Define a runtime-controller interface**

Extract the surface used by `AgentHost`:

```ts
interface AgentRuntimeController {
  onChanged(listener: (run: AgentRun) => void): () => void
  start(input: AgentStartRequest): Promise<AgentRun>
  continue(input: AgentContinueRequest): Promise<AgentRun>
  get(runId: string): AgentRunDetail | undefined
  list(): AgentRun[]
  decide(input: ApprovalDecision): Promise<AgentRun>
  cancel(runId: string): Promise<AgentRun>
  shutdown(): Promise<void>
}
```

Keep the legacy `AgentRuntime` structurally compatible; its `continue` method rejects because legacy runs cannot wait for model input.

- [ ] **Step 2: Write failing model-loop tests**

Cover remote-context approval, read tool, write approval, approved execution, tool-output continuation, build failure, model-directed repair, successful rebuild, evidence-backed final output, approval rejection returned to the model, clarification/resume, missing model configuration, unsafe path, invalid arguments, refusal, malformed final output, loop detection, cancellation, and all budgets.

- [ ] **Step 3: Verify the tests fail**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test`

Expected: `OpenAiAgentRuntime` does not exist.

- [ ] **Step 4: Implement the state machine**

Maintain per-run state containing the original request, context, model input items, call evidence, pending function call, turn/call counters, controller, and deadline. Process one function call per model turn. Persist every run transition, timeline event, approval, and tool call through the existing `RuntimeStore`.

- [ ] **Step 5: Implement final-evidence validation**

Reject `completed` output when referenced calls are absent, failed, or do not support claimed file/build/test actions. Map `needs_input` to `waiting-input` and preserve the session for `continue()`.

- [ ] **Step 6: Run runtime and host tests**

Run: `corepack pnpm --filter @cpp-pet/agent-runtime test && corepack pnpm --filter @cpp-pet/desktop test -- agent-host.test.ts`

Expected: the complete loop and host interface tests pass.

### Task 5: Desktop Context, Model Factory, and Conversation Resume

**Files:**
- Modify: `apps/desktop/src/main/agent-integration.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/conversation-service.ts`
- Modify: `apps/desktop/src/main/conversation-service.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/agent.ts`
- Modify: `packages/contracts/src/conversation.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Write failing desktop integration tests**

Assert that the context envelope contains the unchanged prompt, active file and hash, diagnostics, environment, recent conversation, learner memory, policy, and no secrets or absolute paths. Assert that a waiting-input conversation creates a new exchange and resumes the same run.

- [ ] **Step 2: Replace `DesktopPlanner` with a Responses model factory**

Resolve the enabled profile and key for every new run, create `OpenAiResponsesClient`, and return `MODEL_NOT_CONFIGURED` when unavailable. Remove `H3WorkflowPlanner` and `ResilientPlanner` from the desktop execution path.

- [ ] **Step 3: Wire `OpenAiAgentRuntime`**

Construct it with `DatabaseRuntimeStore`, `DesktopContextBuilder`, the Responses model factory, `McpRuntimeToolClient`, and `createOpenAiToolRegistry(localToolDefinitions)`.

- [ ] **Step 4: Implement clarification resume**

When a conversation has a `waiting-input` run, `conversations:submit-agent` creates the user/assistant exchange and calls `AgentHost.continue` instead of starting a new run. `ConversationService.handleAgentRunChanged` persists the clarification message and later final message with accurate statuses.

- [ ] **Step 5: Update model connection testing**

Test the configured `/responses` endpoint with a minimal structured request. Remove the Chat Completions planner probe.

- [ ] **Step 6: Run desktop unit and integration tests**

Run: `corepack pnpm --filter @cpp-pet/desktop test && corepack pnpm --filter @cpp-pet/desktop typecheck`

Expected: desktop main, preload, store, and conversation tests pass.

### Task 6: Remove Local Natural-Language Routing

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/AgentComposer.vue`
- Modify: `apps/desktop/src/renderer/src/components/ConversationPanel.vue`
- Delete: `apps/desktop/src/renderer/src/utils/agent-intent.ts`
- Delete: `apps/desktop/src/renderer/src/utils/agent-intent.test.ts`
- Delete: `packages/agent-runtime/src/edit-request.ts`
- Modify: `packages/agent-runtime/src/model-gateway.ts`
- Modify: `packages/agent-runtime/src/model-gateway.test.ts`
- Modify: `packages/agent-runtime/src/workflows.ts`
- Modify: `packages/agent-runtime/src/workflows.test.ts`

- [ ] **Step 1: Write failing composer tests or assertions**

Assert every submitted natural-language request uses `mode: "auto"` and is emitted through `tool-submit`, including explanation-only prompts and malformed edit prompts.

- [ ] **Step 2: Remove semantic preprocessing**

Delete intent regexes and deterministic edit extraction. Keep legacy workflow code only where historical tests or explicit non-language paths still require it; it must not be imported by the new desktop runtime.

- [ ] **Step 3: Route every Agent prompt to the runtime**

Remove the `mode === "chat"` streaming branch from `ConversationPanel`. The composer passes the raw trimmed text unchanged with active context metadata and `mode: "auto"`.

- [ ] **Step 4: Remove Chat Completions planning exports**

Delete or stop exporting `OpenAiCompatiblePlanner`, `ResilientPlanner`, and `DeterministicPlanner` after their desktop callers and tests have migrated. Preserve the separate streaming gateway only if another non-Agent UI still uses it.

- [ ] **Step 5: Run repository search and tests**

Run: `rg -n "inferAgentMode|applyRequestedEdit|OpenAiCompatiblePlanner|chat/completions" apps packages tests`

Expected: no active Agent execution path contains these identifiers or endpoint.

Run: `corepack pnpm test`

Expected: all workspace tests pass.

### Task 7: Responses API Electron End-to-End Coverage

**Files:**
- Modify: `tests/e2e/electron-env.ts`
- Rewrite: `tests/e2e/agent-edit-task.spec.ts`
- Modify: `tests/e2e/agent-conversations.spec.ts`
- Modify: `tests/e2e/beginner-tour.spec.ts`
- Modify: `tests/e2e/h3.spec.ts`

- [ ] **Step 1: Build a deterministic fake Responses server**

Record every `/v1/responses` request. Return native `function_call` items for reads, writes, builds, and repair turns; accept matching `function_call_output`; return a strict final JSON message. Add fixture modes for refusal, invalid final output, clarification, and slow cancellation.

- [ ] **Step 2: Rewrite the malformed-prompt scenario**

Use the exact screenshot prompt with its missing closing quote. Verify byte-for-byte prompt preservation at the fixture, remote-context approval, patch approval, editor refresh, successful compiler evidence returned to the model, and final explanations of `main`, `cout`, and `endl`.

- [ ] **Step 3: Migrate conversation and onboarding scenarios**

Replace Chat Completions fixtures with Responses fixtures and update assertions for truthful model-loop states. Keep Markdown sanitization, cancellation, conversation isolation, and approval-card coverage.

- [ ] **Step 4: Run targeted Electron tests**

Run: `corepack pnpm --filter @cpp-pet/desktop build && node node_modules/@playwright/test/cli.js test tests/e2e/agent-edit-task.spec.ts tests/e2e/agent-conversations.spec.ts tests/e2e/beginner-tour.spec.ts tests/e2e/h3.spec.ts`

Expected: all targeted E2E scenarios pass.

### Task 8: Completion Audit and Publish-Ready Verification

**Files:**
- Modify documentation only when verification reveals an actual mismatch.

- [ ] **Step 1: Run full verification**

Run: `corepack pnpm verify`

Expected: typecheck, all tests, production build, and the full Electron E2E suite pass.

- [ ] **Step 2: Audit every design acceptance criterion**

Confirm with repository searches and test evidence that no natural-language preprocessing remains, all Agent requests use `/responses`, every function comes from the MCP registry, tool results loop back to the model, approvals remain enforced, and no semantic fallback exists.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check`, `git status --short`, and `git diff --stat`.

Expected: no whitespace errors; only planned source, test, contract, and documentation changes are present; `.superpowers/` remains excluded.

- [ ] **Step 4: Commit the implementation**

Stage only the planned files and commit with:

```text
feat: implement OpenAI Responses agent loop
```
