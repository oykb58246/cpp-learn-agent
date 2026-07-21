---
name: cpppilot-readme-writer
description: Use when writing or updating CppPilot README, final project summary, or showcase docs from actual repository state, especially after desktop pet, Agent sync, XP, OJ, multimodal screenshot, NSIS packaging, or H4/1-4 delivery changes.
---

# CppPilot README Writer

## Overview

Write CppPilot project README files as factual Chinese showcase documentation grounded in the inspected codebase, tests, packaging outputs, and delivery notes.

## Workflow

1. Inspect before writing: read `README.md`, manifests, package scripts, key source files, tests, `electron-builder.yml`, and delivery docs.
2. Read `references/fact-checklist.md` before drafting final README content.
3. Preserve traceability: archive the previous root README to `docs/archive/README-previous.md` before replacing it.
4. Use a compact Chinese showcase style: project identity first, current implemented status, user workflow, feature groups, architecture, commands, validation, packaging, and documentation links.
5. Mention only verified behavior. If screenshots or real Windows UI were not manually inspected, list them as manual confirmation items instead of claiming they were checked.
6. Keep private data out: no API keys, local user secrets, raw chat transcripts, or absolute local image paths in README.

## CppPilot Facts To Keep Accurate

- Product: Windows Electron + Vue + TypeScript desktop C++ learning Agent with desktop pet.
- User-facing flows: workspace/editor, C++ compile/run/debug, Agent conversation, approvals, screenshot question, settings, OJ practice, learning progress.
- H4 delivery: transparent desktop pet, custom PNG/JPG/WEBP/GIF assets, cyber progress bar, tray/shortcuts, screenshot multimodal `input_image`, OpenAI-compatible BYOK gateway, NSIS installer.
- XP loop: code-edited, build/test/review/error/project/practice/knowledge events plus idempotent achievement XP rewards.
- OJ loop: every exercise has 5 judge cases, each 20 points, total 100; screenshot import must provide or generate 5 trusted cases through model input_image, otherwise refuse.

## README Shape

Use these sections unless the project state suggests a tighter variant:

- Centered title block with factual badges.
- `📖 项目简介`.
- `🔁 使用流程`.
- `✨ 核心能力`.
- `🧠 学习成长与 XP 规则`.
- `🧪 OJ 判题规则`.
- `🛠️ 技术架构`.
- `🚀 本地运行与打包`.
- `✅ 验证状态`.
- `📁 项目结构`.
- `📄 文档与说明`.

## Validation

Before claiming the README is final, check links, commands, current package scripts, installer path, and validation result claims. If final commands are still running or failed, mark the README state honestly.