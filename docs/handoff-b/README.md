# 成员 B 当前交接入口

最后更新：2026-07-24

当前交接基于 `main` 分支的同步基线 `1bb0ca8 feat: improve assistant and OJ workflows`，并包含同步后完成的环境、桌宠、设置、模型、练习导入、工作区文件树和功能帮助改进。

## 建议阅读顺序

1. `docs/handoff-b/post-sync-handoff-2026-07-24.md`
2. `docs/handoff-b/post-sync-acceptance-2026-07-24.md`
3. `docs/handoff-b/runbook.md`
4. `docs/handoff-b/contracts.md`
5. `docs/handoff-b/known-issues.md`

## 当前启动方式

```powershell
git pull origin main
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm dev
```

不要直接运行 `apps/desktop/node_modules/.bin/electron-vite.cmd dev`。仓库根脚本会从正确的 Electron Vite 配置启动，并处理项目约定的安装检查。

## 本批次说明

- 没有新增 npm/pnpm 依赖，也没有修改 `package.json` 或 `pnpm-lock.yaml`。
- 数据库新增 v17 迁移，为模型配置增加 provider、protocol 和 capabilities。
- Renderer 仍只能通过 `window.cppPet` 使用主进程能力。
- 本地测试截图、Playwright 产物、用户数据、日志、IDE 配置和凭据文件已加入 `.gitignore`。
- 提交前已通过 66 个测试文件、387 项单元/集成测试和 17 个真实 Electron E2E。
- 历史 H2 文档仍保留，用于了解工具链、Monaco、CMake、clangd、GDB 和布局持久化的原始交付范围。
