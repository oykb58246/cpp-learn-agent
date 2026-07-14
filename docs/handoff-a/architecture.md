# H1 架构说明

## 进程边界

```text
Vue Renderer
    │ window.cppPet（固定方法）
Sandboxed Preload
    │ ipcRenderer.invoke / event
Electron Main
    ├─ AppDatabase（better-sqlite3）
    ├─ WorkspaceService
    ├─ Electron dialog / nativeTheme / BrowserWindow
    └─ chokidar 项目监听
```

- Renderer 开启 Sandbox，不能使用 Node、Electron 或任意 IPC。
- Preload 是 CommonJS `.cjs` 产物，只依赖 Electron 和无运行时依赖的 IPC 常量入口。
- Main 校验发送窗口、Zod Schema、工作区信任和项目 Root 后才调用领域服务。
- SQLite 只在 Main 中打开，项目源文件始终保存在用户选择的工作区。

## 包依赖

```text
contracts <- database <- workspace-core <- desktop/main
contracts <- desktop/preload
contracts <- ui-kit <- desktop/renderer
```

`contracts` 是跨阶段唯一公共契约。成员 B 扩展工具链和编辑器能力时，应新增 Schema 和 IPC，而不是让 Renderer 绕过 Preload。

## 启动顺序

1. 确定 Electron `userData`。
2. 打开 SQLite、检查迁移 checksum、执行备份和迁移。
3. 初始化 WorkspaceService 与快照对象存储。
4. 注册白名单 IPC。
5. 创建启用 `contextIsolation`、`sandbox` 和 `webSecurity` 的主窗口。
6. Renderer 获取 Bootstrap、最近项目、工作区与确定性 Mock。

## 成员 B 接入点

- 实现 `EditorHost` 的 Monaco Adapter，保留现有 FileDocument、FileRevision 和冲突状态。
- 复用 WorkspaceService 的安全路径、哈希写入、快照和 watcher，不在编辑器内复制文件逻辑。
- 工具链和子进程必须在 Main、Utility Process 或第一方工具进程中运行。
- 新增工具链事件时沿用 `ApiResult`、`AppError` 和 sender/schema 校验模式。
