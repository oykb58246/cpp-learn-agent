# 成员 B 同步后验收清单

验收日期：2026-07-24

基线：`1bb0ca8` 之后的成员 B 本批次改动

## 自动验证

- [x] `corepack pnpm typecheck`
- [x] `corepack pnpm test`
- [x] `corepack pnpm build`
- [x] `corepack pnpm test:e2e`
- [x] `git diff --check`

结果：

- TypeScript / Vue 类型检查全部通过。
- 66 个 Vitest 测试文件、387 项测试全部通过。
- 7 个工作区包的生产构建全部通过。
- 17 个真实 Electron Playwright E2E 全部通过。
- Git 差异没有空白错误；构建、E2E、用户数据、日志、IDE 配置和凭据类文件均已忽略。

## 环境向导

- [ ] 已安装最新版 LLVM 时，WinGet 显示“没有可用升级”后不会再标记为安装失败。
- [ ] LLVM 不在 PATH 但注册表存在安装目录时，可以检测 `clang++`、`clangd` 或 `clang-tidy`。
- [ ] 安装后仍缺少 `clangd` 时，界面提示检查 LLVM bin 目录和 PATH。

## 桌宠与托盘

- [ ] 桌宠右键菜单可以进入工作区、练习、知识树和助教记录。
- [ ] “截图提问”“设置”“退出 CppPilot”可用。
- [ ] 托盘和桌宠菜单行为一致。
- [ ] 显示/隐藏、隐藏一小时、专注模式、开机启动和鼠标穿透未回归。

## 设置与模型

- [ ] 设置页按七个模块分页显示，不再同时堆叠全部设置。
- [ ] `/settings?section=models` 可以直接打开模型服务模块。
- [ ] OpenAI 预设指向 Responses API。
- [ ] DeepSeek 预设指向 Chat Completions。
- [ ] 自定义模型可以选择 auto、Responses 或 Chat Completions。
- [ ] 模型连接测试显示实际使用协议和延迟。
- [ ] 图片能力测试成功后自动开启 `vision`，失败时保持或更新为关闭。
- [ ] 重启后 provider、protocol 和 capabilities 保持。

## 练习导入

- [ ] 未配置启用模型和 API Key 时不能导入题面。
- [ ] 未通过图片能力测试时，PNG/JPG/WEBP 被阻止并提示前往模型设置。
- [ ] Markdown、TXT 和 JSON 在文本能力开启时可进入模型解析流程。
- [ ] 超过 1 MB 的文本题面被拒绝。
- [ ] 模型返回不足 5 个判题用例时不添加练习。
- [ ] 成功导入后新题加入目录并自动打开。

## 工作区文件树

- [ ] 项目根节点可折叠。
- [ ] 目录排在文件之前，名称按自然顺序排列。
- [ ] 每深入一级增加 18px 缩进，并显示淡色竖向引导线。
- [ ] 右键根目录或目录可在对应位置新建文件和文件夹。
- [ ] 右键条目可复制相对路径和绝对路径。
- [ ] 重命名、复制、移动和删除保持可用。
- [ ] 260px 左右的侧栏宽度下，多级目录没有文字重叠。

## 功能帮助

- [ ] 工具栏帮助按钮可以打开完整帮助对话框。
- [ ] 编译、运行、工程构建、CTest、分析、调试和 VS Code 按钮右键可进入对应主题。
- [ ] 快照和文件管理右键菜单可进入对应主题。
- [ ] 760px 以下窗口中帮助导航切换为顶部两列布局。

## 安全与兼容

- [ ] Renderer 无 Node、Electron 和通用 IPC 能力。
- [ ] 复制路径仅通过 `app:copy-text`，输入最大 4096 字符。
- [ ] API Key 不进入 SQLite、日志或 Renderer 返回值。
- [ ] 旧模型数据能够通过 v17 迁移并获得默认 provider、protocol 和 capabilities。
- [ ] 本批次没有新增第三方依赖或锁文件变化。
