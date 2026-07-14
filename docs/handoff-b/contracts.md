# H2 工具契约

## 边界

- Renderer 只使用 `window.cppPet`。
- Preload 只暴露固定方法，不暴露通用 `ipcRenderer.invoke`。
- Main 使用 Zod 校验输入，并通过 `projectId` 解析授权项目 Root。
- 文件参数是项目内相对路径；执行路径由 Main 生成。

## 编译与工程

| IPC | 用途 |
|---|---|
| `compiler:build` | 当前 C++ 文件编译 |
| `program:run` / `program:stop` | 运行和停止编译产物 |
| `cmake:build` | CMake configure/build 与 compile database |
| `ctest:run` | 运行当前会话中已登记的构建 |
| `analysis:clang-tidy` | 静态分析与标准化诊断 |
| `vscode:open` | `code -n` 新窗口和 `-g` 行列定位 |
| `environment:open-download` | 打开白名单中的官方工具下载页面 |
| `environment:installer-status` | 检查 WinGet 是否可运行 |
| `environment:install` | 经确认后打开白名单软件包的可见安装终端 |

编译、链接、运行时、clangd、clang-tidy、调试器和测试问题统一为 `Diagnostic`。

`environment:open-download` 只接受 `msys2`、`llvm`、`cmake`、`vscode` 和 `visual-studio` 五个枚举值。Renderer 不能传入 URL。

`environment:install` 只接受 `msys2`、`llvm`、`cmake` 和 `vscode`。Main 固定映射到允许的软件包 ID，Renderer 不能提交软件包 ID、命令、参数或脚本。安装前必须经过 Electron 原生确认框，PowerShell 窗口保持可见。

## 语言服务

| IPC | 输入/输出 |
|---|---|
| `language:status` | 查询当前工具链是否有 clangd |
| `language:sync` | 全量同步文件内容和版本 |
| `language:completion` | 行列到补全项 |
| `language:hover` | 行列到 Markdown 悬停内容 |
| `language:definition` | 行列到项目相对路径、行、列 |
| `language:diagnostics` | Main 推送项目文件诊断 |

Main 为每个项目维护一个 `ClangdSession`，使用标准 `Content-Length` JSON-RPC/LSP stdio framing。CMake 最近构建目录存在 `compile_commands.json` 时传给 clangd。

## 调试

| IPC | 输入/输出 |
|---|---|
| `debug:start` | 项目、当前源文件、标准、断点列表到 `DebugSessionState` |
| `debug:command` | 会话 ID 与 continue/next/step-in/step-out/stop |

`DebugSessionState` 包含：

- `status`: starting/running/stopped/exited/error
- `location`: 当前项目文件、行、列
- `frames`: 调用栈
- `variables`: 当前栈帧局部变量
- `output`: 调试器/被调程序输出
- `diagnostics`: 调试构建诊断

对外 API 与后端无关，当前实现为 GDB/MI2。未来接 DAP 时应保持 Renderer 契约不变，只替换 Main 后端。

## 安全规则

- 调试和运行只允许 trusted workspace。
- C++ 文件扩展名在 Main 再次校验。
- 断点路径通过 `safePath()` 校验。
- 调试器路径来自已绑定工具链，不接受用户命令文本。
- 调试源码和产物位于应用 `userData/builds`，启动时清理。
