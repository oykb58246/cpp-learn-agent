import type { KnowledgeGateResult, KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'

const node = (
  id: string,
  title: string,
  category: string,
  difficulty: number,
  prerequisites: string[] = [],
  tags: string[] = []
): KnowledgeNode => ({
  id,
  title,
  description: `掌握 ${title} 的核心概念与可验证用法。`,
  category,
  difficulty,
  prerequisites,
  tags
})

export const builtInKnowledge: KnowledgeNode[] = [
  node('basics.program', '程序结构', 'basics', 1, [], ['main']),
  node('basics.io', '标准输入输出', 'basics', 1, ['basics.program'], ['cin', 'cout']),
  node('basics.variables', '变量', 'basics', 1, ['basics.program'], ['declaration']),
  node('basics.types', '基本类型', 'basics', 1, ['basics.variables'], ['int', 'double', 'bool']),
  node('basics.operators', '运算符', 'basics', 1, ['basics.types'], ['arithmetic']),
  node('basics.expressions', '表达式', 'basics', 1, ['basics.operators'], ['precedence']),
  node('control.conditions', '条件分支', 'control-flow', 1, ['basics.expressions'], ['if', 'switch']),
  node('control.loops', '循环', 'control-flow', 1, ['control.conditions'], ['for', 'while']),
  node('functions.basic', '函数', 'functions', 1, ['basics.types'], ['parameter', 'return']),
  node('functions.overload', '函数重载', 'functions', 2, ['functions.basic'], ['overload']),
  node('data.arrays', '数组', 'data', 1, ['control.loops'], ['array']),
  node('data.strings', '字符串', 'data', 1, ['data.arrays'], ['string']),
  node('data.structs', '结构体', 'data', 2, ['basics.types'], ['struct']),
  node('memory.pointers', '指针', 'memory', 2, ['data.arrays'], ['pointer']),
  node('memory.references', '引用', 'memory', 2, ['functions.basic'], ['reference']),
  node('memory.dynamic', '动态内存', 'memory', 3, ['memory.pointers'], ['new', 'delete']),
  node('oop.classes', '类与对象', 'oop', 2, ['data.structs', 'functions.basic'], ['class']),
  node('oop.constructors', '构造与析构', 'oop', 2, ['oop.classes'], ['constructor', 'destructor']),
  node('oop.inheritance', '继承', 'oop', 3, ['oop.constructors'], ['inheritance']),
  node('oop.polymorphism', '多态', 'oop', 3, ['oop.inheritance', 'memory.references'], ['virtual']),
  node('generic.templates', '模板', 'generic', 3, ['functions.overload'], ['template']),
  node('errors.exceptions', '异常处理', 'reliability', 2, ['functions.basic'], ['try', 'catch']),
  node('io.files', '文件输入输出', 'io', 2, ['basics.io', 'data.strings'], ['fstream']),
  node('stl.vector', 'vector 容器', 'stl', 2, ['generic.templates', 'data.arrays'], ['vector']),
  node('stl.map', 'map 容器', 'stl', 3, ['generic.templates', 'data.structs'], ['map']),
  node('stl.iterators', '迭代器', 'stl', 3, ['stl.vector'], ['iterator']),
  node('stl.algorithm', '标准算法', 'stl', 3, ['stl.iterators'], ['algorithm']),
  node('modern.lambdas', 'Lambda 表达式', 'modern-cpp', 3, ['functions.basic'], ['lambda']),
  node('modern.smart-pointers', '智能指针', 'modern-cpp', 3, ['memory.dynamic', 'generic.templates'], ['unique_ptr']),
  node('modern.move-semantics', '移动语义', 'modern-cpp', 4, ['oop.constructors', 'memory.references'], ['move']),
  node('organization.namespaces', '命名空间', 'project', 2, ['functions.basic'], ['namespace']),
  node('organization.headers', '头文件', 'project', 2, ['basics.program', 'functions.basic'], ['include']),
  node('organization.multi-file', '多文件工程', 'project', 2, ['organization.headers', 'organization.namespaces'], ['translation-unit']),
  node('tools.cmake', 'CMake 构建', 'tools', 3, ['organization.multi-file'], ['cmake']),
  node('quality.testing', '程序测试', 'quality', 2, ['functions.basic', 'control.conditions'], ['test']),
  node('quality.debugging', '断点调试', 'quality', 2, ['control.loops', 'functions.basic'], ['debug']),
  node('quality.static-analysis', '静态分析', 'quality', 3, ['organization.multi-file'], ['clang-tidy']),
  node('advanced.concurrency', '并发基础', 'advanced', 5, ['modern.lambdas', 'oop.classes'], ['thread'])
]

export function validateKnowledgeGraph(nodes: KnowledgeNode[]): string[] {
  const errors: string[] = []
  const byId = new Map(nodes.map(item => [item.id, item]))
  if (byId.size !== nodes.length) errors.push('duplicate concept id')
  for (const item of nodes) {
    for (const prerequisite of item.prerequisites) {
      if (!byId.has(prerequisite)) errors.push(`${item.id}: missing prerequisite ${prerequisite}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) { errors.push(`${id}: cycle detected`); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) visit(prerequisite)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)
  return [...new Set(errors)]
}

export class KnowledgeGate {
  private readonly byId: Map<string, KnowledgeNode>

  constructor(readonly nodes: KnowledgeNode[]) {
    const errors = validateKnowledgeGraph(nodes)
    if (errors.length) throw new Error(`Invalid knowledge graph: ${errors.join('; ')}`)
    this.byId = new Map(nodes.map(item => [item.id, item]))
  }

  check(
    conceptIds: string[],
    states: LearnerKnowledge[],
    options: { allowRewrite?: boolean } = {}
  ): KnowledgeGateResult {
    const learned = new Set(states
      .filter(item => ['learning', 'self-claimed', 'verified', 'review'].includes(item.status))
      .map(item => item.conceptId))
    const allowed = new Set<string>()
    const includePrerequisites = (id: string): void => {
      if (allowed.has(id)) return
      allowed.add(id)
      for (const prerequisite of this.byId.get(id)?.prerequisites ?? []) includePrerequisites(prerequisite)
    }
    for (const id of learned) includePrerequisites(id)

    const requested = [...new Set(conceptIds)]
    const permitted = requested.filter(id => allowed.has(id))
    const blocked = requested.filter(id => !allowed.has(id))
    if (!blocked.length) {
      return { decision: 'allow', allowed: permitted, blocked: [], suggestedConceptIds: [], explanation: '所需概念位于当前知识边界内。' }
    }
    const suggestedConceptIds = [...new Set(blocked.flatMap(id => this.firstMissingPrerequisites(id, allowed)))]
    const decision = options.allowRewrite && permitted.length ? 'rewrite' : 'learn'
    return {
      decision,
      allowed: permitted,
      blocked,
      suggestedConceptIds,
      explanation: decision === 'rewrite'
        ? '回答需要改写为当前已学概念能够表达的形式。'
        : '继续前需要先学习所列前置概念。'
    }
  }

  private firstMissingPrerequisites(id: string, allowed: Set<string>): string[] {
    const item = this.byId.get(id)
    if (!item) return [id]
    const missing = item.prerequisites.filter(prerequisite => !allowed.has(prerequisite))
    return missing.length ? missing : [id]
  }
}

