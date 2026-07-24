# 成员 B 同步后功能交接

交接日期：2026-07-24

目标分支：`main`

同步基线：`1bb0ca8 feat: improve assistant and OJ workflows`

## 1. 本批次目标

本批次是在拉取队友最新 `main` 后完成的兼容与体验增强，重点解决：

- 已安装 LLVM 但 WinGet 返回“无可用升级”时被误判为安装失败。
- 桌宠右键菜单入口不足，无法快速进入学习模块或退出应用。
- 设置页模块堆叠过长，模型配置无法表达接口协议和输入能力。
- OJ 题面图片没有先检查模型视觉能力，且不能导入 Markdown 等文本题面。
- 工作区文件树层级、排序和右键操作不够接近 VS Code。
- 编译、运行、工程构建、调试等功能缺少就地帮助。

## 2. 已完成功能

### 2.1 环境安装与 LLVM 检测

- WinGet 安装脚本识别 `-1978335189` 和 `2316632107` 两个“已安装且无可用升级”退出码，并转为重新检测流程。
- LLVM 安装后仍缺少 `clangd` 时，给出 `C:\Program Files\LLVM\bin\clangd.exe` 与 PATH 检查提示。
- Windows 工具链检测会读取 LLVM 卸载注册表项，根据 `InstallLocation` 或卸载命令补充 LLVM 安装根目录。
- `clang++`、`clangd`、`clang-tidy` 和 `lldb` 会同时从 PATH、常见目录和注册表安装目录查找。

主要文件：

- `apps/desktop/src/main/environment-install.ts`
- `packages/cpp-local-tools/src/index.ts`

### 2.2 桌宠与托盘快捷入口

桌宠右键菜单和托盘菜单现在共用完整菜单，新增：

- 打开工作区
- 打开练习
- 打开知识树
- 查看助教记录
- 截图提问
- 设置
- 退出 CppPilot

保留显示/隐藏、隐藏一小时、专注模式、开机启动和鼠标穿透等原有功能。

主要文件：

- `apps/desktop/src/main/tray.ts`
- `apps/desktop/src/main/index.ts`

### 2.3 设置页模块化

设置页改为左侧模块导航、右侧单模块内容，包含：

- 外观
- 桌宠
- C++ 工具链
- 工作区
- Agent 权限
- 模型服务
- 本地数据

路由仍支持 `/settings?section=models` 等链接；窄窗口下导航切换为两列顶部布局。

主要文件：

- `apps/desktop/src/renderer/src/views/SettingsView.vue`
- `apps/desktop/src/renderer/src/styles/app.css`

### 2.4 模型协议与能力配置

模型配置不再只依赖 Base URL 推断，新增以下字段：

- `provider`: `openai | deepseek | custom`
- `protocol`: `auto | openai-responses | openai-chat-completions`
- `capabilities.text`
- `capabilities.vision`
- `capabilities.toolCalling`
- `capabilities.structuredOutput`

设置页提供 OpenAI、DeepSeek 和自定义服务预设，显示最终请求端点，并允许分别测试：

- 基础连接与实际协议
- 图片输入能力

图片能力测试会向配置模型发送一张内置的 1x1 红色 PNG，并要求返回固定结果。测试结果会更新并持久化 `capabilities.vision`。

Agent Runtime 根据实际协议选择 `/responses` 或 `/chat/completions`，并根据能力开关决定是否发送 tools 和结构化输出参数。所有模型请求增加配置级超时。

主要文件：

- `packages/contracts/src/agent.ts`
- `packages/agent-runtime/src/responses-client.ts`
- `apps/desktop/src/main/model-capability-test.ts`
- `apps/desktop/src/renderer/src/stores/agent.ts`
- `apps/desktop/src/renderer/src/views/SettingsView.vue`

### 2.5 OJ 多格式题面导入

练习页现在支持：

- PNG、JPG、WEBP
- Markdown：`.md`、`.markdown`
- 纯文本：`.txt`
- JSON：`.json`

导入规则：

- 图片导入要求启用模型、已配置 API Key，并且 `capabilities.vision` 为 `true`。
- 文本导入要求 `capabilities.text` 为 `true`，单文件最大 1 MB。
- 图片和文本都会根据模型协议构造 Responses API 或 Chat Completions 请求。
- 上传内容按不可信数据处理，提示词要求忽略题面中的任务劫持指令。
- 模型必须返回完整题意和正好 5 个可信判题用例，否则拒绝加入题库。

主要文件：

- `packages/contracts/src/future.ts`
- `apps/desktop/src/main/practice-import.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/renderer/src/views/PracticeView.vue`

兼容说明：Preload 方法名暂时仍为 `learning.importOjScreenshot`，但参数已经升级为 `PracticeOjImportInput` 联合类型，以避免一次性修改已有调用方。

### 2.6 VS Code 风格工作区文件树

工作区左侧资源管理器新增：

- 项目根目录单行折叠/展开。
- 目录优先、同类名称自然排序。
- 23px 紧凑行高。
- 每级 18px 缩进和淡色竖向层级引导线。
- 目录使用折叠箭头，文件保留轻量类型图标。
- 右键新建文件、新建文件夹、刷新、复制相对路径、复制绝对路径、重命名、复制、移动和删除。
- 根目录和文件夹右键新建时自动带入父目录。

复制路径通过受限 IPC `app:copy-text` 调用 Electron clipboard；Renderer 没有获得 Node、Electron 或通用 IPC 权限。

主要文件：

- `packages/workspace-core/src/index.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/components/FileTree.vue`
- `apps/desktop/src/renderer/src/views/WorkspaceView.vue`

### 2.7 就地功能帮助

新增统一帮助对话框，覆盖：

- 文件与目录管理
- 编译当前文件
- 编译并运行
- CMake 工程构建
- CTest
- clang-tidy 静态分析
- GDB 断点调试
- VS Code 联动
- 项目快照
- 教学 Agent

工作区工具栏中的相关按钮支持右键查看对应帮助，也可以点击工具栏帮助按钮浏览全部主题。

主要文件：

- `apps/desktop/src/renderer/src/components/FeatureHelpDialog.vue`
- `apps/desktop/src/renderer/src/utils/feature-help.ts`
- `apps/desktop/src/renderer/src/views/WorkspaceView.vue`

### 2.8 同步后兼容与 E2E 收尾

- Agent 处于 `waiting-input` 时会同时显示停止和发送按钮，用户可以在原 run 上提交澄清答案，也可以取消任务。
- Electron E2E 通过 `.app-shell` 识别主应用窗口，不再依赖桌宠窗口和主窗口的创建顺序。
- 工作区 Agent 默认打开或关闭时，测试会先读取实际状态再切换，避免重复点击导致面板状态相反。
- E2E 已对齐当前 `随心输入` 占位符、设置模块分页、17 阶段知识看板和 OpenAI Responses API 状态文案。

主要文件：

- `apps/desktop/src/renderer/src/components/AgentComposer.vue`
- `tests/e2e/electron-env.ts`
- `tests/e2e/agent-openai-protocol.spec.ts`
- `tests/e2e/beginner-tour.spec.ts`
- `tests/e2e/h3.spec.ts`

## 3. 契约与数据变更

### IPC

新增：

- `app:copy-text`
- `model:test-vision`

变更：

- `model:test` 返回实际协议和能力快照。
- `learning.importOjScreenshot` 接受图片或文本联合输入。

### 数据库

新增迁移：

- v17 `model-profile-protocol-and-capabilities`

`model_profiles` 新增：

- `provider TEXT`
- `protocol TEXT`
- `capabilities_json TEXT`

旧模型会根据 Base URL 推断 OpenAI、DeepSeek 或 custom，默认能力为文本、工具调用和结构化输出开启，图片能力关闭。

## 4. 依赖变化

本批次没有新增第三方依赖：

- `package.json` 未变化。
- `apps/desktop/package.json` 未变化。
- `pnpm-lock.yaml` 未变化。

功能使用现有 Electron、Vue、Pinia、Zod、Lucide、Element Plus 和 Playwright/Vitest 能力实现。

## 5. 测试覆盖

新增或扩展的测试覆盖：

- WinGet 无升级退出码和 LLVM 检测提示。
- Windows LLVM 注册表路径解析。
- 桌宠/托盘快捷入口与退出。
- 安全剪贴板 IPC。
- 模型 provider、protocol、capabilities 契约。
- Responses 与 Chat Completions 协议选择和能力开关。
- 图片能力测试成功、拒绝、异常响应。
- OJ 图片能力门禁与 Markdown/TXT/JSON 请求构造。
- 设置模块导航与练习页能力提示。
- 文件树目录优先排序和 18px 层级缩进。
- 功能帮助主题完整性。
- 等待澄清时在同一 Agent run 上继续提交输入。
- Electron 主窗口稳定识别和 Agent 面板状态切换。
- 新手引导、知识看板和设置分页的当前 UI 契约。

提交前自动验证结果：

- 类型检查通过。
- 66 个 Vitest 测试文件、387 项测试通过。
- 生产构建通过。
- 17 个真实 Electron E2E 通过。
- `git diff --check` 通过。

完整验收清单见 `post-sync-acceptance-2026-07-24.md`。

## 6. 接手注意事项

- 图片能力测试会产生一次真实模型请求，可能消耗少量额度。
- 自定义服务必须确认实际兼容所选协议；`auto` 对 DeepSeek 选择 Chat Completions，其余默认选择 Responses。
- 图片能力测试通过只代表基础图片输入可用，不代表所有图片尺寸、格式或推理任务都稳定。
- 文本题面最大 1 MB；图片 Data URL 仍受 5,000,000 字符契约上限约束。
- 模型导入结果仍必须满足 5 个判题用例；信息不足时拒绝比猜测更优先。
- 文件树复制绝对路径依赖当前工作区根路径和项目相对根拼接，IPC 文本长度限制为 4096。
- 数据库迁移会在首次启动新版本时自动执行；不要手工修改 `model_profiles`。
- 本地视觉截图和 Playwright 产物位于 `test-results/`，已忽略，不随交接提交。
- Agent 等待补充信息时，发送按钮用于继续当前任务，停止按钮用于取消当前任务。

## 7. 建议后续工作

- 用至少一个 OpenAI Responses 模型、一个 DeepSeek 模型和一个第三方 Chat Completions 服务做真实兼容矩阵。
- 增加 OJ 文本导入的文件编码检测，目前依赖浏览器 `File.text()`。
- 为文件树加入键盘导航、重命名内联编辑和多选操作。
- 将功能帮助扩展到练习、知识树和模型配置页面。
- 为模型能力增加版本化探测时间、最后测试状态和失败原因展示。
