# H1 接口契约

公共类型位于 `packages/contracts`，Preload 在 `window.cppPet` 下按领域暴露 API。

## 命名空间

| 命名空间 | 已实现能力 |
|---|---|
| `app` | Bootstrap、版本、平台和恢复状态 |
| `settings` | 系统/浅色/深色主题与基础设置 |
| `workspace` | 原生 Root 选择、列表、信任、撤销、变化事件 |
| `project` | 手动/题目/描述预览、导入预览、创建、打开、移除 |
| `files` | 文件树、读取、写入、创建、复制、移动、重命名、删除、搜索 |
| `snapshots` | 创建、列表、恢复预览、恢复、删除 |
| `mocks` | 环境、学习和后续模块的确定性演示数据 |

## 关键约束

- 所有方法返回 `ApiResult<T>`，不可用抛出字符串替代结构化错误。
- 文件操作只接受 `projectId + relativePath`，不接受 Renderer 提供的任意绝对路径。
- 写入必须携带 `expectedHash`，磁盘版本变化时返回 `FILE_REVISION_CONFLICT`。
- 工作区事件订阅返回取消函数，组件销毁时必须解除监听。
- Preload 不能增加 `send(channel)`、`invoke(channel)` 等通用入口。

## IPC 常量

IPC 名称集中在 `@cpp-pet/contracts/ipc`。该子入口无 Zod 等外部运行时依赖，确保 Electron Sandbox Preload 可加载。

成员 B/C 新增接口时需要同步完成：类型、Zod Schema、IPC 常量、Main handler、Preload 方法、契约测试和调用示例。
