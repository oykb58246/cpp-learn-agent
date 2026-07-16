# H1 测试报告

## 最终结果

在 Windows 11、Node.js 22.19.0、pnpm 10.24.0、Electron 43.1.0 环境执行：

```powershell
pnpm verify
```

结果：通过。命令连续完成 workspace 类型检查、Node ABI 原生模块重建、单元测试、生产构建、Electron ABI 重建和 Playwright Electron E2E，总耗时约 66 秒。

| 层级 | 结果 |
|---|---|
| TypeScript / Vue 类型检查 | 5 个 workspace 包通过 |
| 契约测试 | 4 个通过 |
| 数据库测试 | 2 个通过 |
| 工作区核心测试 | 6 个通过 |
| Electron E2E | 1 个真实应用流程通过 |
| 生产构建 | Main、Preload、Renderer 全部成功 |

单元测试合计 12 个，Electron E2E 1 个，失败 0 个。

## 自动化范围

| 层级 | 覆盖内容 |
|---|---|
| 契约 | Schema 默认值、非法 Workspace、编辑内容大小限制、未来模块契约 |
| 数据库 | 重启持久化、迁移失败回滚、迁移前备份、只读恢复写入拒绝 |
| 工作区核心 | 路径穿越、绝对路径、Windows 设备名、Junction 逃逸、工作区信任 |
| 项目 | 单文件、多文件、CMake、题目、描述和无改写导入 |
| 文件 | 哈希冲突、复制、移动、搜索、删除前快照 |
| 快照 | 创建、内容恢复、恢复前快照和无引用 Blob 清理 |
| Electron E2E | 原生启动、Bootstrap、Preload 隔离、真实 SQLite 项目、文件保存、自动快照 |
| 视觉 | 1440×900 浅/深首页与工作区、1024×720 工作区、横向溢出检查 |

## 安全断言

- Renderer 中 `window.require` 和 `window.process` 不存在。
- `window.cppPet` 存在，但没有通用 `invoke` 或任意频道发送能力。
- Preload 产物为 `index.cjs`，不加载 Sandbox 禁止的第三方模块。
- Root 外路径、`..`、Windows 设备名和 Junction 逃逸被拒绝。
- 未信任工作区和数据库恢复模式无法执行写操作。

## 视觉证据

`pnpm test:e2e` 生成并完成像素尺寸和横向溢出断言：

- `test-results/visual/home-1440x900.png`
- `test-results/visual/workspace-1440x900.png`
- `test-results/visual/workspace-1024x720.png`
- `test-results/visual/home-dark-1440x900.png`
- `test-results/visual/workspace-dark-1440x900.png`

人工复核上述截图，未发现控件遮挡、文本溢出、空白渲染或分栏漂移。

## 构建说明

- `pnpm install --frozen-lockfile` 通过，当前 `pnpm-lock.yaml` 与全部 workspace 清单一致。
- `pnpm package:dir` 通过，生成 `release/win-unpacked/CppPilot.exe`。
- 目录包可执行文件已直接启动验证，进程保持运行且成功创建 Windows 主窗口。
- Windows 可执行文件、任务栏和窗口使用 `apps/desktop/build/icon.ico`，不再使用默认 Electron 图标。
- `better-sqlite3` 同时服务 Node 单元测试与 Electron 运行时，脚本会在两个 ABI 间自动重建。
- 含空格的仓库路径会触发 `node-gyp` 历史兼容性提示；本次原生模块重建和 E2E 均成功，该提示不阻断交付。
- Renderer 构建会提示第三方 `@vueuse/core` 的 PURE 注释位置，并自动移除该注释；不影响产物运行。
- H1 交接以本报告、`h1-acceptance.md` 和独立环境复验结果共同为准。
