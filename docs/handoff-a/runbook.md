# H1 运行手册

## 环境

- Windows 10/11 x64
- Node.js 22+
- pnpm 10+
- better-sqlite3 源码重建需要 Python 与 Visual Studio C++ Build Tools

## 安装

Electron 二进制较大。网络受限时可先设置镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
pnpm install
```

## 开发

```powershell
pnpm dev
```

`pnpm dev` 会先把 better-sqlite3 重建为 Electron ABI，再启动 electron-vite。

## 测试和验证

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm verify
```

注意：Node 单元测试和 Electron 使用不同原生 ABI。

- `pnpm test` 会先执行 `native:node`。
- `pnpm test:e2e`、`pnpm dev` 和 `pnpm package:dir` 会执行 `native:electron`。
- 不要在 Electron 仍运行时切换 ABI，否则 Windows 会锁住 `.node` 文件。

## 目录包

```powershell
pnpm package:dir
```

产物位于根目录 `release`。成员 D 再补签名、安装器目标和发布元数据。

## 故障排查

### `NODE_MODULE_VERSION` 不一致

按目标环境执行 `pnpm native:node` 或 `pnpm native:electron`，并先关闭所有本项目 Electron 进程。

### Preload 未注入

确认 `out/preload/index.cjs` 存在，且产物只 `require("electron")`，不能出现 `require("zod")` 等沙箱不允许的依赖。

### 迁移失败

应用会进入只读恢复模式。先备份当前 `userData`，再检查 `backups/pre-migration-*.sqlite`，不要直接删除用户工作区文件。
