# H2 运行手册

## 首次运行

```powershell
git pull origin main
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
```

不要直接执行 `apps/desktop/node_modules/.bin/electron-vite.cmd dev`。仓库入口会先处理原生模块 ABI，再从正确的 Electron 配置启动。

全新用户数据会进入环境初始化向导：

1. 自动检测本机编译器、调试器、clangd、CMake 和 VS Code。
2. 选择候选工具链，并通过真实 Hello World 编译运行后绑定。
3. 选择并信任一个代码工作区。
4. 确认环境摘要后进入首页或工作区。

缺失项可以使用 Main 中预设的官方页面。系统 WinGet 可用时，也可以在确认后打开可见 PowerShell 安装终端；软件包 ID 和命令由 Main 固定，不接受 Renderer 自定义。安装结束后向导显示成功或失败状态，成功时自动重新检测。

用户选择“稍后配置”时会看到找回路径。跳过后首页显示环境提醒，可从“设置 → C++ 工具链 → 环境向导”重新进入。

MSYS2 的 WinGet 安装只负责安装 MSYS2 本体。完成后打开“MSYS2 UCRT64”，执行向导展示的固定 `pacman` 命令安装 GCC 和 GDB，再返回应用重新检测。

## 原生模块 ABI

Node 单测和 Electron 使用不同的 `better-sqlite3` ABI：

```powershell
pnpm native:node
pnpm test
pnpm native:electron
```

`pnpm test` 会自动切到 Node ABI，但不会自动切回。启动 `pnpm dev`、执行 `pnpm test:e2e` 或 `pnpm package:dir` 前必须恢复 Electron ABI。切换前关闭正在运行的本项目 Electron 进程。

## 工具链

1. 在设置页点击检测工具链。
2. 选择通过 Hello World 验证的 GCC、Clang 或 MSVC。
3. 调试需要带 `debuggerPath` 的 GCC/GDB；当前 MSVC 调试未接入。
4. clangd 和 clang-tidy 来自 LLVM，安装后重新检测并绑定。

## clangd 操作

- 打开 C++ 文件后自动同步文档。
- 补全、悬停和定义跳转由 Monaco Provider 调用主进程 LSP 会话。
- CMake 工程先执行“工程构建”，clangd 会使用最近构建的 `compile_commands.json`。
- 未安装 clangd 时状态栏显示基础编辑模式，编译运行不受影响。

## 调试操作

1. 打开 `.cpp`、`.cc` 或 `.cxx` 文件。
2. 点击行号左侧的 glyph margin 设置/取消断点。
3. 点击工具栏“调试”。
4. 在底部“调试”页签查看局部变量、调用栈和输出。
5. 使用“继续、跨过、进入、跳出、停止调试”控制会话。

没有断点时会使用当前光标行。单文件调试会把源码暂存到 Electron `userData/builds` 的 ASCII 路径，再把暂停位置映射回项目文件。

## 工作区布局

- 拖动文件侧边栏右边界可调整文件树宽度。
- 拖动快照侧边栏左边界可调整快照区域宽度。
- 拖动输出/问题/调试面板上边界可调整底部面板高度。
- 分隔线获得焦点后可使用方向键微调，按住 Shift 可增大步长。
- 双击分隔线或在键盘焦点下按 Home 恢复默认尺寸。
- 三个尺寸保存在 `AppSettings`，应用重启后自动恢复；小窗口会临时收紧侧栏以保留编辑区域。

## 常用验证

```powershell
pnpm typecheck
pnpm test
pnpm native:electron
pnpm build
pnpm test:e2e
git diff --check
```

完整 E2E 覆盖安全 Preload、Monaco 保存、编译运行、真实 GDB 变量单步、CMake/CTest、布局拖拽与持久化、响应式布局和深色主题。
