# B 阶段 C++ 固定样例

这些样例用于工具链、诊断、运行安全和后续 Agent 工作流回归。

| 目录 | 预期 |
|---|---|
| `success` | 编译、运行成功，输出 `CPP_PET_SUCCESS` |
| `syntax-error` | 编译失败，产生语法诊断 |
| `link-error` | 链接失败，产生未定义符号诊断 |
| `infinite-loop` | 运行超时并回收进程 |
| `runtime-crash` | 非零退出或访问冲突 |
| `logic-error` | 编译运行成功，但固定测试用例失败 |
