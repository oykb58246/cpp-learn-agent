import type { PracticeExercise, PracticeJudgeCase, PracticeProjectTask } from '@cpp-pet/contracts'

const catalogTime = '2026-07-20T00:00:00.000Z'

type CaseInput = Omit<PracticeJudgeCase, 'id' | 'score'>
type ExerciseInput = Omit<PracticeExercise, 'source' | 'createdAt' | 'updatedAt' | 'judgeCases'> & { judgeCases: CaseInput[] }

const sample = (input: string, expectedOutput: string, reason = '样例覆盖'): CaseInput => ({ input, expectedOutput, visibility: 'sample', reason })
const hidden = (input: string, expectedOutput: string, reason = '隐藏边界覆盖'): CaseInput => ({ input, expectedOutput, visibility: 'hidden', reason })

function exercise(input: ExerciseInput): PracticeExercise {
  return {
    ...input,
    judgeCases: input.judgeCases.map((item, index) => ({
      id: `${input.id}-case-${index + 1}`,
      input: item.input,
      expectedOutput: item.expectedOutput,
      score: 20,
      visibility: item.visibility,
      ...(item.reason ? { reason: item.reason } : {})
    })),
    source: 'built-in',
    createdAt: catalogTime,
    updatedAt: catalogTime
  }
}

export const builtInPracticeExercises: PracticeExercise[] = [
  exercise({
    id: 'builtin-io-sum-two', title: '两数求和', knowledgePoint: '输入输出', conceptIds: ['basics.io', 'basics.operators'], difficulty: 1,
    statement: '输入两个整数 a 和 b，输出它们的和。', constraints: ['-100000 <= a,b <= 100000'],
    samples: [{ input: '1 2', output: '3' }],
    judgeCases: [sample('1 2', '3'), hidden('-5 7', '2'), hidden('0 0', '0'), hidden('100000 -100000', '0'), hidden('-99999 -1', '-100000')],
    starterCode: '#include <iostream>\nusing namespace std;\nint main() {\n    long long a, b;\n    cin >> a >> b;\n    cout << a + b << "\\n";\n    return 0;\n}\n'
  }),
  exercise({
    id: 'builtin-io-average', title: '三科平均分', knowledgePoint: '输入输出', conceptIds: ['basics.io', 'basics.types'], difficulty: 1,
    statement: '输入三门课程分数，输出保留两位小数的平均分。', constraints: ['0 <= score <= 100'],
    samples: [{ input: '90 80 70', output: '80.00' }],
    judgeCases: [sample('90 80 70', '80.00'), hidden('100 100 100', '100.00'), hidden('0 0 0', '0.00'), hidden('1 2 2', '1.67'), hidden('99 98 97', '98.00')],
    starterCode: '#include <iomanip>\n#include <iostream>\nusing namespace std;\nint main() {\n    double a, b, c;\n    cin >> a >> b >> c;\n    cout << fixed << setprecision(2) << (a + b + c) / 3 << "\\n";\n}\n'
  }),
  exercise({
    id: 'builtin-io-rectangle', title: '矩形面积和周长', knowledgePoint: '输入输出', conceptIds: ['basics.io', 'basics.operators'], difficulty: 1,
    statement: '输入矩形的长和宽，输出面积和周长，中间用一个空格分隔。', constraints: ['1 <= 长,宽 <= 100000'],
    samples: [{ input: '3 4', output: '12 14' }],
    judgeCases: [sample('3 4', '12 14'), hidden('1 1', '1 4'), hidden('2 100', '200 204'), hidden('100000 1', '100000 200002'), hidden('123 456', '56088 1158')]
  }),
  exercise({
    id: 'builtin-branch-max', title: '三个数最大值', knowledgePoint: '条件分支', conceptIds: ['control.conditions'], difficulty: 1,
    statement: '输入三个整数，输出其中最大值。', constraints: ['-10^9 <= 每个整数 <= 10^9'],
    samples: [{ input: '3 9 7', output: '9' }],
    judgeCases: [sample('3 9 7', '9'), hidden('-1 -2 -3', '-1'), hidden('5 5 4', '5'), hidden('0 1000000000 -1', '1000000000'), hidden('-7 8 8', '8')]
  }),
  exercise({
    id: 'builtin-branch-leap-year', title: '闰年判断', knowledgePoint: '条件分支', conceptIds: ['control.conditions', 'basics.operators'], difficulty: 2,
    statement: '输入年份，判断是否为闰年。闰年输出 YES，否则输出 NO。', constraints: ['1 <= year <= 9999'],
    samples: [{ input: '2000', output: 'YES' }, { input: '1900', output: 'NO' }],
    judgeCases: [sample('2000', 'YES'), hidden('1900', 'NO'), hidden('2024', 'YES'), hidden('2100', 'NO'), hidden('1999', 'NO')]
  }),
  exercise({
    id: 'builtin-branch-grade', title: '成绩等级', knowledgePoint: '条件分支', conceptIds: ['control.conditions'], difficulty: 1,
    statement: '输入一个 0 到 100 的整数成绩，按 A(90+)、B(80+)、C(70+)、D(60+)、F(60 以下) 输出等级。', constraints: ['0 <= score <= 100'],
    samples: [{ input: '95', output: 'A' }],
    judgeCases: [sample('95', 'A'), hidden('85', 'B'), hidden('75', 'C'), hidden('65', 'D'), hidden('40', 'F')]
  }),
  exercise({
    id: 'builtin-loop-factorial', title: '阶乘取模', knowledgePoint: '循环', conceptIds: ['control.loops'], difficulty: 2,
    statement: '输入 n，输出 n! 对 1000000007 取模的结果。', constraints: ['0 <= n <= 100000'],
    samples: [{ input: '5', output: '120' }],
    judgeCases: [sample('5', '120'), hidden('0', '1'), hidden('10', '3628800'), hidden('13', '227020758'), hidden('20', '146326063')]
  }),
  exercise({
    id: 'builtin-loop-digit-sum', title: '数字和', knowledgePoint: '循环', conceptIds: ['control.loops', 'basics.types'], difficulty: 1,
    statement: '输入一个非负整数，输出它每一位数字之和。', constraints: ['0 <= n <= 10^18'],
    samples: [{ input: '120305', output: '11' }],
    judgeCases: [sample('120305', '11'), hidden('0', '0'), hidden('9', '9'), hidden('1000000000000000000', '1'), hidden('999999999999999999', '162')]
  }),
  exercise({
    id: 'builtin-loop-count-multiples', title: '倍数计数', knowledgePoint: '循环', conceptIds: ['control.loops', 'basics.operators'], difficulty: 1,
    statement: '输入 n 和 k，输出 1 到 n 中能被 k 整除的整数个数。', constraints: ['1 <= n,k <= 10^9'],
    samples: [{ input: '10 3', output: '3' }],
    judgeCases: [sample('10 3', '3'), hidden('1 1', '1'), hidden('100 10', '10'), hidden('999 1000', '0'), hidden('1000000000 7', '142857142')]
  }),
  exercise({
    id: 'builtin-array-prefix-sum', title: '区间求和', knowledgePoint: '数组', conceptIds: ['data.arrays'], difficulty: 2,
    statement: '给定 n 个整数和 q 次查询，每次查询 l r，输出下标 l 到 r 的元素和。下标从 1 开始。', constraints: ['1 <= n,q <= 100000', '-10000 <= ai <= 10000'],
    samples: [{ input: '5 2\n1 2 3 4 5\n1 3\n2 5', output: '6\n14' }],
    judgeCases: [sample('5 2\n1 2 3 4 5\n1 3\n2 5', '6\n14'), hidden('1 1\n-5\n1 1', '-5'), hidden('3 2\n10 -10 5\n1 2\n3 3', '0\n5'), hidden('4 3\n0 0 0 0\n1 4\n2 2\n3 4', '0\n0\n0'), hidden('6 1\n1 1 1 1 1 1\n4 6', '3')]
  }),
  exercise({
    id: 'builtin-array-rotate', title: '数组右移', knowledgePoint: '数组', conceptIds: ['data.arrays'], difficulty: 2,
    statement: '输入 n 个整数和 k，将数组循环右移 k 位后输出。', constraints: ['1 <= n <= 100000', '0 <= k <= 10^9'],
    samples: [{ input: '5 2\n1 2 3 4 5', output: '4 5 1 2 3' }],
    judgeCases: [sample('5 2\n1 2 3 4 5', '4 5 1 2 3'), hidden('1 100\n9', '9'), hidden('4 0\n1 2 3 4', '1 2 3 4'), hidden('4 4\n1 2 3 4', '1 2 3 4'), hidden('6 8\n10 20 30 40 50 60', '50 60 10 20 30 40')]
  }),
  exercise({
    id: 'builtin-array-max-subarray', title: '最大连续子段和', knowledgePoint: '数组', conceptIds: ['data.arrays', 'control.loops'], difficulty: 3,
    statement: '输入 n 个整数，输出一个非空连续子数组的最大和。', constraints: ['1 <= n <= 100000', '-10^9 <= ai <= 10^9'],
    samples: [{ input: '5\n-2 3 -1 5 -4', output: '7' }],
    judgeCases: [sample('5\n-2 3 -1 5 -4', '7'), hidden('3\n-5 -1 -7', '-1'), hidden('1\n10', '10'), hidden('6\n1 -2 3 4 -1 2', '8'), hidden('4\n0 0 0 0', '0')]
  }),
  exercise({
    id: 'builtin-string-palindrome', title: '回文串判断', knowledgePoint: '字符串', conceptIds: ['data.strings'], difficulty: 1,
    statement: '输入一个只包含小写字母的字符串，判断它是否为回文串。是输出 YES，否则输出 NO。', constraints: ['1 <= 字符串长度 <= 100000'],
    samples: [{ input: 'level', output: 'YES' }, { input: 'cpp', output: 'NO' }],
    judgeCases: [sample('level', 'YES'), hidden('cpp', 'NO'), hidden('a', 'YES'), hidden('abccba', 'YES'), hidden('abcbaq', 'NO')]
  }),
  exercise({
    id: 'builtin-string-word-count', title: '单词计数', knowledgePoint: '字符串', conceptIds: ['data.strings'], difficulty: 2,
    statement: '输入一行英文句子，单词由一个或多个空格分隔，输出单词数量。', constraints: ['行长度不超过 10000'],
    samples: [{ input: 'hello   modern cpp', output: '3' }],
    judgeCases: [sample('hello   modern cpp', '3'), hidden('one', '1'), hidden('   ', '0'), hidden('  a  b  ', '2'), hidden('\n', '0')]
  }),
  exercise({
    id: 'builtin-string-char-frequency', title: '最高频字符', knowledgePoint: '字符串', conceptIds: ['data.strings', 'data.arrays'], difficulty: 2,
    statement: '输入一个只包含小写字母的字符串，输出出现次数最多的字符和次数；次数相同输出字典序最小的字符。', constraints: ['1 <= 字符串长度 <= 100000'],
    samples: [{ input: 'banana', output: 'a 3' }],
    judgeCases: [sample('banana', 'a 3'), hidden('abc', 'a 1'), hidden('zzzza', 'z 4'), hidden('mississippi', 'i 4'), hidden('a', 'a 1')]
  }),
  exercise({
    id: 'builtin-function-prime', title: '素数判定函数', knowledgePoint: '函数', conceptIds: ['functions.basic', 'math.prime'], difficulty: 2,
    statement: '输入 n，判断 n 是否为素数。要求把判定逻辑封装为函数。', constraints: ['1 <= n <= 10^9'],
    samples: [{ input: '97', output: 'YES' }, { input: '1', output: 'NO' }],
    judgeCases: [sample('97', 'YES'), hidden('1', 'NO'), hidden('2', 'YES'), hidden('1000000000', 'NO'), hidden('999983', 'YES')]
  }),
  exercise({
    id: 'builtin-function-gcd-lcm', title: '最大公约数与最小公倍数', knowledgePoint: '函数', conceptIds: ['functions.basic', 'math.gcd'], difficulty: 2,
    statement: '输入两个正整数 a 和 b，输出它们的最大公约数和最小公倍数。', constraints: ['1 <= a,b <= 10^9'],
    samples: [{ input: '12 18', output: '6 36' }],
    judgeCases: [sample('12 18', '6 36'), hidden('1 1', '1 1'), hidden('7 13', '1 91'), hidden('1000000000 1', '1 1000000000'), hidden('48 180', '12 720')]
  }),
  exercise({
    id: 'builtin-recursion-sum', title: '递归求和', knowledgePoint: '递归', conceptIds: ['recursion.basic'], difficulty: 2,
    statement: '输入 n，使用递归函数计算 1 到 n 的和。', constraints: ['1 <= n <= 10000'],
    samples: [{ input: '100', output: '5050' }],
    judgeCases: [sample('100', '5050'), hidden('1', '1'), hidden('10000', '50005000'), hidden('10', '55'), hidden('999', '499500')]
  }),
  exercise({
    id: 'builtin-recursion-fibonacci', title: '记忆化斐波那契', knowledgePoint: '递归', conceptIds: ['recursion.basic', 'data.arrays'], difficulty: 3,
    statement: '输入 n，输出斐波那契数 F(n)。规定 F(0)=0，F(1)=1。建议使用递归加记忆化。', constraints: ['0 <= n <= 45'],
    samples: [{ input: '7', output: '13' }],
    judgeCases: [sample('7', '13'), hidden('0', '0'), hidden('1', '1'), hidden('20', '6765'), hidden('45', '1134903170')]
  }),
  exercise({
    id: 'builtin-struct-student-sort', title: '学生成绩排序', knowledgePoint: '结构体', conceptIds: ['data.structs', 'sorting.basic'], difficulty: 3,
    statement: '输入 n 名学生的姓名和分数，按分数从高到低排序；分数相同按姓名字典序升序。输出排序后的姓名和分数。', constraints: ['1 <= n <= 1000', '姓名只包含英文字母'],
    samples: [{ input: '3\nAlice 90\nBob 95\nAmy 90', output: 'Bob 95\nAlice 90\nAmy 90' }],
    judgeCases: [sample('3\nAlice 90\nBob 95\nAmy 90', 'Bob 95\nAlice 90\nAmy 90'), hidden('1\nTom 60', 'Tom 60'), hidden('2\nZoe 100\nAnn 100', 'Ann 100\nZoe 100'), hidden('4\nA 70\nB 80\nC 80\nD 60', 'B 80\nC 80\nA 70\nD 60'), hidden('3\nLi 0\nWang 1\nZhao 0', 'Wang 1\nLi 0\nZhao 0')]
  }),
  exercise({
    id: 'builtin-sort-second-key', title: '按双关键字排序', knowledgePoint: '排序', conceptIds: ['sorting.basic'], difficulty: 3,
    statement: '输入 n 个二元组 x y，按 x 升序排序；x 相同按 y 降序排序。输出排序后的二元组。', constraints: ['1 <= n <= 200000'],
    samples: [{ input: '4\n2 1\n1 3\n2 5\n1 2', output: '1 3\n1 2\n2 5\n2 1' }],
    judgeCases: [sample('4\n2 1\n1 3\n2 5\n1 2', '1 3\n1 2\n2 5\n2 1'), hidden('1\n0 0', '0 0'), hidden('3\n1 1\n1 3\n1 2', '1 3\n1 2\n1 1'), hidden('3\n-1 5\n0 0\n-1 6', '-1 6\n-1 5\n0 0'), hidden('5\n2 2\n2 2\n1 9\n3 0\n1 1', '1 9\n1 1\n2 2\n2 2\n3 0')]
  }),
  exercise({
    id: 'builtin-vector-dedup', title: '去重后输出', knowledgePoint: 'STL 容器', conceptIds: ['stl.vector', 'sorting.basic'], difficulty: 2,
    statement: '输入 n 个整数，按从小到大输出去重后的结果。', constraints: ['1 <= n <= 200000'],
    samples: [{ input: '7\n3 1 2 3 2 5 1', output: '1 2 3 5' }],
    judgeCases: [sample('7\n3 1 2 3 2 5 1', '1 2 3 5'), hidden('1\n9', '9'), hidden('5\n5 5 5 5 5', '5'), hidden('4\n-1 0 -1 2', '-1 0 2'), hidden('6\n10 9 8 7 8 9', '7 8 9 10')]
  }),
  exercise({
    id: 'builtin-set-intersection-count', title: '集合交集计数', knowledgePoint: 'STL set', conceptIds: ['stl.set'], difficulty: 3,
    statement: '输入两个整数序列，输出两个序列中共同出现过的不同整数个数。', constraints: ['1 <= n,m <= 200000'],
    samples: [{ input: '5 4\n1 2 2 3 5\n2 2 4 5', output: '2' }],
    judgeCases: [sample('5 4\n1 2 2 3 5\n2 2 4 5', '2'), hidden('1 1\n1\n1', '1'), hidden('3 3\n1 2 3\n4 5 6', '0'), hidden('4 5\n-1 -1 0 2\n0 0 -1 3 4', '2'), hidden('6 3\n1 2 3 4 5 6\n2 4 6', '3')]
  }),
  exercise({
    id: 'builtin-map-frequency', title: '词频统计', knowledgePoint: 'STL map', conceptIds: ['stl.map', 'data.strings'], difficulty: 3,
    statement: '输入 n 个单词，输出出现次数最多的单词；如果有多个，输出字典序最小的。', constraints: ['1 <= n <= 100000', '单词长度不超过 50'],
    samples: [{ input: '5\ncpp\naio\ncpp\narray\naio', output: 'aio 2' }],
    judgeCases: [sample('5\ncpp\naio\ncpp\narray\naio', 'aio 2'), hidden('1\nonly', 'only 1'), hidden('4\nb\na\nb\na', 'a 2'), hidden('6\nz\ny\nx\ny\ny\nz', 'y 3'), hidden('3\ncpp\ncpp\ncpp', 'cpp 3')]
  }),
  exercise({
    id: 'builtin-queue-simulation', title: '队列命令模拟', knowledgePoint: '队列与栈', conceptIds: ['stl.queue'], difficulty: 3,
    statement: '输入 n 条命令。PUSH x 入队，POP 出队，FRONT 查询队首。队列为空时 FRONT 输出 EMPTY，空队列 POP 直接忽略。', constraints: ['1 <= n <= 100000'],
    samples: [{ input: '5\nPUSH 1\nPUSH 2\nFRONT\nPOP\nFRONT', output: '1\n2' }],
    judgeCases: [sample('5\nPUSH 1\nPUSH 2\nFRONT\nPOP\nFRONT', '1\n2'), hidden('2\nFRONT\nPOP', 'EMPTY'), hidden('4\nPUSH 7\nPOP\nFRONT\nPUSH 9', 'EMPTY'), hidden('6\nPUSH 3\nPUSH 4\nPOP\nPUSH 5\nFRONT\nPOP', '4'), hidden('3\nPUSH 10\nFRONT\nFRONT', '10\n10')]
  }),
  exercise({
    id: 'builtin-stack-brackets', title: '括号匹配', knowledgePoint: '队列与栈', conceptIds: ['stl.stack', 'data.strings'], difficulty: 3,
    statement: '输入一个只包含 ()[]{} 的字符串，判断括号是否完全匹配。匹配输出 YES，否则输出 NO。', constraints: ['1 <= 字符串长度 <= 100000'],
    samples: [{ input: '([]{})', output: 'YES' }],
    judgeCases: [sample('([]{})', 'YES'), hidden('([)]', 'NO'), hidden('()', 'YES'), hidden('(((', 'NO'), hidden('{[()]}', 'YES')]
  }),
  exercise({
    id: 'builtin-binary-search-lower-bound', title: '第一个不小于 x 的位置', knowledgePoint: '二分查找', conceptIds: ['search.binary'], difficulty: 3,
    statement: '给定升序数组和 q 次查询，每次输出第一个不小于 x 的位置；若不存在输出 -1。下标从 1 开始。', constraints: ['1 <= n,q <= 200000'],
    samples: [{ input: '5 3\n1 2 4 4 8\n4\n5\n0', output: '3\n5\n1' }],
    judgeCases: [sample('5 3\n1 2 4 4 8\n4\n5\n0', '3\n5\n1'), hidden('1 2\n10\n1\n10', '1\n1'), hidden('3 2\n1 3 5\n6\n0', '-1\n1'), hidden('4 3\n2 2 2 2\n2\n1\n3', '1\n1\n-1'), hidden('6 2\n-5 -1 0 0 7 9\n0\n8', '3\n6')]
  })
]

export const builtInPracticeProjects: PracticeProjectTask[] = [
  {
    id: 'project-gradebook', title: '成绩册统计器', knowledgePoint: '结构体与排序', conceptIds: ['data.structs', 'sorting.basic'], difficulty: 2,
    description: '实现一个命令行成绩册，读取学生姓名和成绩，输出平均分、最高分学生以及按分数排序的列表。',
    goals: ['用结构体保存学生信息', '实现稳定的排序规则', '处理空输入和并列分数'],
    suggestedFiles: ['main.cpp', 'README.md']
  },
  {
    id: 'project-todo-cli', title: '待办清单 CLI', knowledgePoint: 'STL 容器', conceptIds: ['stl.vector', 'data.strings'], difficulty: 2,
    description: '实现一个支持 add/list/done/remove 的简单待办清单程序，数据保存在内存中。',
    goals: ['解析基础命令', '用 vector 管理列表', '输出清晰的状态'],
    suggestedFiles: ['main.cpp']
  },
  {
    id: 'project-word-counter', title: '文本词频分析器', knowledgePoint: '字符串与 map', conceptIds: ['data.strings', 'stl.map'], difficulty: 3,
    description: '读取多行文本，统计单词频率并输出 Top K。需要忽略大小写和常见标点。',
    goals: ['完成字符串清洗', '用 map 或 unordered_map 计数', '实现 Top K 排序'],
    suggestedFiles: ['main.cpp', 'samples/input.txt']
  },
  {
    id: 'project-mini-judge', title: '迷你判题器', knowledgePoint: '输入输出与测试', conceptIds: ['basics.io', 'control.conditions', 'control.loops', 'quality.testing'], difficulty: 4,
    description: '实现一个读取若干测试用例、比较实际输出与期望输出的迷你判题器。',
    goals: ['设计测试用例结构', '逐条比较输出', '汇总通过数量和失败原因'],
    suggestedFiles: ['main.cpp', 'cases.txt']
  },
  {
    id: 'project-library-search', title: '图书检索小系统', knowledgePoint: '结构体与二分', conceptIds: ['data.structs', 'search.binary', 'sorting.basic'], difficulty: 4,
    description: '维护一批图书记录，支持按编号二分查找、按作者过滤、按标题排序展示。',
    goals: ['为记录设计结构体', '排序后进行二分查找', '拆分清晰的函数'],
    suggestedFiles: ['main.cpp', 'book.hpp']
  }
]