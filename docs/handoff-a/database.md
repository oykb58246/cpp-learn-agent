# H1 数据库与快照

## 数据位置

```text
<userData>/
├─ data/cpp-pet.sqlite
├─ backups/pre-migration-*.sqlite
└─ snapshots/
   ├─ manifests/<snapshot-id>.json
   └─ blobs/<sha256>.gz
```

## SQLite 设置

- Foreign Keys：开启
- Journal Mode：WAL
- Synchronous：NORMAL
- Busy Timeout：5000 ms
- 退出前执行 WAL checkpoint

## H1 表

- `schema_migrations`：版本、名称、checksum、应用时间。
- `settings`：应用设置 JSON。
- `workspaces`：授权 Root、规范化路径和信任状态。
- `projects`：项目类型、创建模式和 Root 相对路径。
- `file_snapshots` / `snapshot_entries`：快照头和文件清单。
- `domain_events`：项目、文件和快照领域事件。

## 迁移恢复

待迁移时先 checkpoint，再把现有数据库复制到 `backups`。迁移在事务中执行，并在完成后运行 `quick_check`。checksum 不一致或 SQL 失败时保留旧 Schema，应用进入逻辑只读恢复模式；读取保持可用，所有数据库和文件写入被拒绝。

## 快照

- 内容按 SHA-256 去重并 gzip 压缩。
- 保存、删除和恢复前自动创建对应范围快照。
- 恢复前生成新增、覆盖、删除和不变文件预览。
- 删除快照时，仅清理已无任何 Entry 引用的 Blob。
