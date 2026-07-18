# H3 测试报告

## 验证环境

- 日期：2026-07-16
- Windows / PowerShell
- Node.js 24.11.0（ABI 137）
- Electron 43.1.0 / Node 24.18.0（ABI 148）
- pnpm 10.24.0
- GCC/GDB：`D:\TDM-GCC-64\bin`
- VS Code：已检测
- CMake、CTest、clangd、clang-tidy：当前机器未安装

## 自动化结果

| 范围 | 文件 | 测试数 | 结果 |
|---|---:|---:|---|
| Contracts | 3 | 20 | 通过 |
| Database | 3 | 16 | 通过 |
| Agent Runtime | 5 | 37 | 通过 |
| cpp-local-tools | 4 | 18 | 通过 |
| workspace-core | 1 | 6 | 通过 |
| Desktop Main/Renderer | 9 | 33 | 通过 |
| 合计 | 25 | 130 | 通过 |

覆盖包括：非法契约、路径穿越、MCP list/call/progress/cancel/timeout、stdio 握手超时、Runtime 完成/拒绝/取消/批量关闭/时限/重试/降级、Run 和学习事务回滚、重启恢复、Diff 审批、七条真实 GCC 工作流、复习 1/3/7/14/30 调度、XP/等级/17 枚勋章和模型密钥隔离。

## Electron E2E

- H2 首次启动、跳过与找回环境向导：通过。
- H2 安全 Preload、工作区、Monaco、GCC/GDB、布局和缺失 CMake 降级：通过。
- H3 编译错误修复、两次审批、Diff、真实编译、Timeline、错误本、30 XP、勋章、知识树和模型离线状态：通过。
- H3 截图：1440x900 与 1024x720；断言主滚动容器无横向溢出、Agent Timeline 不与回答区重叠，设置粘性目录不遮挡模型标题。

当前机器没有 CMake/CTest，因此 E2E 断言明确的缺失工具提示；真实 CMake/CTest 分支在安装工具的环境执行。cpp-local-tools 测试同样只在检测到工具时运行真实固定 fixture。

## 构建

- Main、MCP Worker、Preload、Renderer 和 Monaco Worker 构建成功。
- Preload 产物保持 sandbox 兼容。
- Renderer 主 bundle 约 9.8 MB，是已记录的非阻断体积问题。
- 不含 `better-sqlite3`，无需原生 ABI 重建。
