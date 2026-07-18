# H3 已知问题

1. 当前验证机器未安装 CMake/CTest；应用显示可恢复提示，未在本机执行真实 CMake E2E。安装后重新检测即可进入原有真实分支。
2. 当前验证机器未安装 clangd/clang-tidy；Monaco 保持基础编辑模式，静态分析给出缺失工具提示。
3. 当前调试后端是 GCC/GDB/MI；DAP、LLDB 和 MSVC 调试属于后续后端扩展。
4. Node 24 命令行运行 `node:sqlite` 测试时打印 ExperimentalWarning；Electron 43 运行不打印，数据库行为已有迁移、事务和 E2E 覆盖。
5. Renderer 主 bundle 约 9.8 MB，后续可按路由拆包；不影响 H3 功能验收。
6. stdio MCP 失败时会使用进程内本地 MCP 降级通道并在首页状态中标明；该通道保持相同 Registry、Policy 和 Adapter，但应排查 Worker 后恢复 stdio。
7. H3 只消费已授权 ScreenshotRef，不采集屏幕像素；截图选择器、OCR 和多模态提供器属于 H4。
8. 透明桌宠、托盘、全局快捷键、最终视觉和安装器属于 H4，不是 H3 缺陷。
