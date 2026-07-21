# CppPilot README Fact Checklist

Use this checklist when updating the root README or final showcase documents.

## Verify From Files

- Root scripts in `package.json`: `dev`, `typecheck`, `test`, `build`, `package:nsis`.
- Desktop scripts and package metadata in `apps/desktop/package.json`.
- NSIS-only packaging in `apps/desktop/electron-builder.yml`.
- Contracts in `packages/contracts/src/index.ts`, `future.ts`, `learning.ts`, `ipc.ts`.
- Learning and OJ data in `packages/agent-runtime/src/practice.ts`, `knowledge.ts`, `achievements.ts`.
- Database migrations and persistence in `packages/database/src/h3.ts`, `index.ts`.
- Desktop pet code in `apps/desktop/src/main/pet-window.ts`, `pet-assets.ts`, renderer `DesktopPet.vue`, `SettingsView.vue`.
- Agent conversation sync in `apps/desktop/src/main/conversation-service.ts`, renderer `stores/agent.ts`, `ConversationPanel.vue`.
- Screenshot import and OJ judge in `apps/desktop/src/main/practice-import.ts`, `practice-judge.ts`.

## Current Delivery Claims

State these only when still true:

- Custom pet assets are persisted in settings and loaded through `cpppilot-pet-asset://`.
- Switching back to Logo does not delete custom asset library rows.
- Desktop pet base window is smaller than the H4 initial `220 x 260`, currently `180 x 220` before scale.
- Growth visuals are a progress bar, not four pet forms.
- Workspace Agent panel and assistant records consume the same conversation/run updates.
- OJ practice supports code editing, submission, 5-case judging, scoring, failed case output diff, and learning events.
- Screenshot import uses multimodal `input_image` and refuses insufficient judge cases.
- Final installer is NSIS only.

## Manual Screenshot Confirmation List

Do not claim these were visually confirmed unless a human actually checked them:

- Desktop pet size and drag boundaries.
- Cyber progress bar readability.
- Custom GIF switching and playback.
- Workspace Agent model-error state.
- OJ submit/judge result panel.
- Settings pet asset list persistence.
- NSIS install experience.