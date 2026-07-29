export type FeatureHelpId =
  | 'workspace-files'
  | 'compile'
  | 'run'
  | 'cmake'
  | 'ctest'
  | 'analysis'
  | 'debug'
  | 'vscode'
  | 'snapshots'
  | 'agent'

export interface FeatureHelpTopic {
  id: FeatureHelpId
  title: string
  category: string
  summary: string
  principle: string
  steps: string[]
  notes: string[]
}

export const featureHelpTopics: FeatureHelpTopic[] = [
  {
    id: 'workspace-files',
    title: '文件与目录管理',
    category: '工作区',
    summary: '项目文件只在当前授权工作区内读写，文件树会自动过滤构建缓存和 CppPilot 内部文件。',
    principle: '所有路径都先转换为项目内相对路径，再由主进程校验真实路径是否仍位于项目根目录，避免越权访问其他目录。',
    steps: [
      '在左侧资源管理器展开目录，单击文件即可打开编辑。',
      '右键项目根目录或文件夹，可以在对应目录中新建文件和文件夹。',
      '右键任意条目可以复制路径、重命名、复制、移动或删除。',
      '删除前应用会自动创建快照，便于误删后恢复。'
    ],
    notes: ['项目根目录下的路径使用相对路径保存。', '未信任的工作区只允许检查，不能创建或修改文件。']
  },
  {
    id: 'compile',
    title: '编译当前文件',
    category: '构建',
    summary: '将当前 C++ 源文件编译为可执行程序，但不自动运行。',
    principle: 'CppPilot 使用已绑定的 GCC、Clang 或 MSVC，根据所选 C++ 标准生成独立构建任务，并把编译器诊断转换成可定位的问题列表。',
    steps: ['打开一个 .cpp、.cc 或 .cxx 文件。', '选择 C++17、C++20 或 C++23。', '点击“编译”，在底部“输出”和“问题”页查看结果。'],
    notes: ['头文件不能单独编译。', '修改会在编译前保存；保存冲突必须先处理。']
  },
  {
    id: 'run',
    title: '编译并运行',
    category: '构建',
    summary: '先编译当前文件，成功后启动生成的程序。',
    principle: '运行使用刚刚生成的构建产物，并在受控进程中捕获标准输出、标准错误、退出码、超时和资源信息。',
    steps: ['在“程序输入”中填写可选标准输入。', '点击“运行”。', '从底部输出查看程序结果和退出码。'],
    notes: ['运行不会复用旧源代码对应的构建结果。', '程序卡住时可点击“停止”。']
  },
  {
    id: 'cmake',
    title: '工程构建',
    category: '构建',
    summary: '配置并构建包含 CMakeLists.txt 的多文件 C++ 工程。',
    principle: '先执行 CMake configure 生成构建系统，再执行 build；成功时同时生成 compile_commands.json，供 clangd 和静态分析理解整个工程。',
    steps: ['打开类型为 CMake 的项目。', '确认 CMakeLists.txt 中定义了可执行目标。', '点击“工程构建”，依次查看配置与构建输出。', '从目标菜单选择程序，点击“运行工程”查看标准输出和退出码。'],
    notes: ['按钮只在 CMake 项目中启用。', '测试 target 也会显示在目标菜单中。', '修改源文件或 CMakeLists.txt 后需要重新执行工程构建。']
  },
  {
    id: 'ctest',
    title: '运行 CTest',
    category: '验证',
    summary: '运行最近一次 CMake 构建中注册的自动化测试。',
    principle: 'CTest 从构建目录读取 add_test 注册的测试，并汇总通过数、失败数、输出与耗时。',
    steps: ['先成功完成一次“工程构建”。', '点击“测试”。', '在底部输出查看每个测试及总体结果。'],
    notes: ['没有 add_test 的工程不会产生可运行测试。', '源代码变化后建议重新构建再测试。']
  },
  {
    id: 'analysis',
    title: '静态分析',
    category: '验证',
    summary: '使用 clang-tidy 在不运行程序的情况下检查当前 C/C++ 文件。',
    principle: '静态分析结合源代码、编译参数和 compile_commands.json 查找潜在错误、可疑写法与可维护性问题。',
    steps: ['打开 C++ 源文件或头文件。', 'CMake 工程建议先完成工程构建。', '点击“分析”，在问题面板定位诊断。'],
    notes: ['静态分析提示不等同于编译错误。', '缺少 clang-tidy 时可在环境向导中安装 LLVM。']
  },
  {
    id: 'debug',
    title: '断点调试',
    category: '调试',
    summary: '使用 GDB 暂停程序并查看局部变量、调用栈和当前执行位置。',
    principle: 'CppPilot 以调试信息编译程序，通过 GDB/MI 协议控制断点、继续、单步进入、跨过和跳出。',
    steps: ['在编辑器行号左侧单击设置断点。', '点击“调试”。', '程序暂停后查看局部变量和调用栈，并使用继续或单步命令。'],
    notes: ['工具链必须包含可用的 GDB。', '优化编译可能导致变量被优化掉或执行行跳动。']
  },
  {
    id: 'vscode',
    title: 'VS Code 联动',
    category: '外部编辑器',
    summary: '在新的 VS Code 窗口打开当前项目，并定位到当前文件、行和列。',
    principle: '应用调用 VS Code CLI 的 --new-window 与 --goto 参数，不会复用或覆盖当前已有窗口。',
    steps: ['把光标放在想定位的代码位置。', '点击工具栏中的外部编辑器图标。', 'VS Code 新窗口会打开项目并定位光标。'],
    notes: ['需要系统能找到 code 命令。', '没有打开文件时只打开项目目录。']
  },
  {
    id: 'snapshots',
    title: '项目快照',
    category: '安全',
    summary: '保存项目文件内容的可恢复版本，用于写入、删除或 Agent 修改前后的回退。',
    principle: '快照按内容哈希去重保存，恢复前会比较当前文件与快照并生成变更预览。',
    steps: ['从编辑器标签栏打开快照面板。', '输入标签创建手动快照。', '选择历史快照查看并恢复。'],
    notes: ['删除文件前会自动创建快照。', '快照保存在本机应用数据目录。']
  },
  {
    id: 'agent',
    title: '教学 Agent',
    category: '助教',
    summary: '结合当前项目、选中代码和诊断信息解释问题，并在授权后调用本地工具。',
    principle: 'Agent 先收集受控上下文，再由模型决定是否读取文件、编译、运行或提出修改；高风险操作遵循设置中的审批策略。',
    steps: ['打开右侧 Agent 面板。', '描述目标，必要时先选中代码。', '检查上下文和审批信息，再决定是否允许工具操作。'],
    notes: ['API Key 只保存在本机安全存储中。', '模型输出不等于验证结果，成功结论应有工具证据。']
  }
]

export function featureHelpTopic(id: FeatureHelpId): FeatureHelpTopic {
  return featureHelpTopics.find(topic => topic.id === id) ?? featureHelpTopics[0]!
}
