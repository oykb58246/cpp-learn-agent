import type { KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'

export type KnowledgePathStatus = 'locked' | 'learning' | 'mastered'

export interface KnowledgePathNode {
  node: KnowledgeNode
  status: KnowledgePathStatus
  missingPrerequisiteIds: string[]
  depth: number
  canAdvance: boolean
}

export interface KnowledgePathLane {
  category: string
  label: string
  stage: number
  rows: KnowledgePathNode[][]
  total: number
  mastered: number
  learning: number
  locked: number
}

export interface KnowledgeTreeBranch {
  entry: KnowledgePathNode
  children: KnowledgeTreeBranch[]
}

export interface KnowledgeTreeSection {
  category: string
  label: string
  roots: KnowledgeTreeBranch[]
  total: number
  mastered: number
  learning: number
  locked: number
}

const activeStatuses = new Set<LearnerKnowledge['status']>(['learning', 'self-claimed', 'verified', 'review'])

const CATEGORY_LABELS: Record<string, string> = {
  basics: '基础',
  'control-flow': '控制流',
  functions: '函数',
  data: '数据',
  memory: '内存',
  oop: '面向对象',
  generic: '泛型',
  reliability: '可靠性',
  io: '输入输出',
  stl: '标准库',
  math: '数学',
  algorithm: '算法',
  'modern-cpp': '现代 C++',
  project: '工程组织',
  tools: '工具链',
  quality: '质量保障',
  advanced: '进阶',
  branches: '分支'
}

const CATEGORY_TONES: Record<string, string> = {
  basics: 'tone-blue',
  'control-flow': 'tone-cyan',
  functions: 'tone-violet',
  data: 'tone-amber',
  memory: 'tone-rose',
  oop: 'tone-indigo',
  generic: 'tone-teal',
  reliability: 'tone-green',
  io: 'tone-sky',
  stl: 'tone-orange',
  math: 'tone-lime',
  algorithm: 'tone-fuchsia',
  'modern-cpp': 'tone-purple',
  project: 'tone-slate',
  tools: 'tone-steel',
  quality: 'tone-mint',
  advanced: 'tone-gold',
  branches: 'tone-cyan'
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

export function categoryTone(category: string): string {
  return CATEGORY_TONES[category] ?? 'tone-blue'
}

export function displayStatusFor(state: LearnerKnowledge | undefined): KnowledgePathStatus {
  if (!state || state.status === 'locked' || state.status === 'available') return 'locked'
  return state.status === 'learning' ? 'learning' : 'mastered'
}

function projectEntries(catalog: KnowledgeNode[], knowledge: LearnerKnowledge[]): KnowledgePathNode[] {
  const byId = new Map(catalog.map(node => [node.id, node]))
  const states = new Map(knowledge.map(state => [state.conceptId, state]))
  const depthCache = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    const prerequisites = byId.get(id)?.prerequisites ?? []
    const depth = prerequisites.length ? Math.max(...prerequisites.map(depthOf)) + 1 : 0
    depthCache.set(id, depth)
    return depth
  }

  return catalog.map(node => {
    const missingPrerequisiteIds = node.prerequisites.filter(id => !activeStatuses.has(states.get(id)?.status ?? 'locked'))
    return {
      node,
      status: displayStatusFor(states.get(node.id)),
      missingPrerequisiteIds,
      depth: depthOf(node.id),
      canAdvance: missingPrerequisiteIds.length === 0
    }
  })
}

function sortCategories(entries: KnowledgePathNode[], catalog: KnowledgeNode[]): string[] {
  const categories = [...new Set(catalog.map(node => node.category))]
  const categoryIndex = new Map(categories.map((category, index) => [category, index]))
  const categoryDepth = new Map(categories.map(category => [
    category,
    Math.min(...entries.filter(entry => entry.node.category === category).map(entry => entry.depth), Number.POSITIVE_INFINITY)
  ]))

  return categories.sort((left, right) => {
    const byDepth = (categoryDepth.get(left) ?? 0) - (categoryDepth.get(right) ?? 0)
    return byDepth || (categoryIndex.get(left) ?? 0) - (categoryIndex.get(right) ?? 0)
  })
}

function compareEntries(left: KnowledgePathNode, right: KnowledgePathNode): number {
  return left.depth - right.depth
    || left.node.difficulty - right.node.difficulty
    || left.node.title.localeCompare(right.node.title, 'zh-Hans-CN')
    || left.node.id.localeCompare(right.node.id)
}

function summarize(entries: KnowledgePathNode[]) {
  return {
    total: entries.length,
    mastered: entries.filter(entry => entry.status === 'mastered').length,
    learning: entries.filter(entry => entry.status === 'learning').length,
    locked: entries.filter(entry => entry.status === 'locked').length
  }
}

export function buildKnowledgeLanes(catalog: KnowledgeNode[], knowledge: LearnerKnowledge[]): KnowledgePathLane[] {
  const entries = projectEntries(catalog, knowledge)
  return sortCategories(entries, catalog).map((category, index) => {
    const categoryEntries = entries.filter(item => item.node.category === category).sort(compareEntries)
    const rows = new Map<number, KnowledgePathNode[]>()
    for (const entry of categoryEntries) {
      const row = rows.get(entry.depth) ?? []
      row.push(entry)
      rows.set(entry.depth, row)
    }
    return {
      category,
      label: categoryLabel(category),
      stage: index + 1,
      rows: [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row.sort(compareEntries)),
      ...summarize(categoryEntries)
    }
  })
}

export function filterKnowledgeLanes(lanes: KnowledgePathLane[], query: string): KnowledgePathLane[] {
  const q = query.trim().toLowerCase()
  if (!q) return lanes

  return lanes.map(lane => {
    const rows = lane.rows
      .map(row => row.filter(entry =>
        entry.node.title.toLowerCase().includes(q)
        || entry.node.description.toLowerCase().includes(q)
        || entry.node.id.toLowerCase().includes(q)
        || entry.node.tags.some(tag => tag.toLowerCase().includes(q))
        || lane.label.toLowerCase().includes(q)
        || lane.category.toLowerCase().includes(q)
      ))
      .filter(row => row.length > 0)
    if (!rows.length && !lane.label.toLowerCase().includes(q) && !lane.category.toLowerCase().includes(q)) return null
    const entries = rows.flat()
    return {
      ...lane,
      rows,
      ...summarize(entries)
    }
  }).filter((lane): lane is KnowledgePathLane => Boolean(lane))
}

function primaryParentId(entry: KnowledgePathNode, byId: Map<string, KnowledgePathNode>): string | null {
  const sameCategoryParents = entry.node.prerequisites
    .map(id => byId.get(id))
    .filter((item): item is KnowledgePathNode => Boolean(item) && item.node.category === entry.node.category)
  if (!sameCategoryParents.length) return null
  sameCategoryParents.sort((left, right) => right.depth - left.depth || left.node.id.localeCompare(right.node.id))
  return sameCategoryParents[0]!.node.id
}

export function buildKnowledgeTree(catalog: KnowledgeNode[], knowledge: LearnerKnowledge[]): KnowledgeTreeSection[] {
  const entries = projectEntries(catalog, knowledge)
  const byId = new Map(entries.map(entry => [entry.node.id, entry]))
  const categories = sortCategories(entries, catalog)

  return categories.map(category => {
    const categoryEntries = entries.filter(entry => entry.node.category === category).sort(compareEntries)
    const branchById = new Map<string, KnowledgeTreeBranch>()
    for (const entry of categoryEntries) {
      branchById.set(entry.node.id, { entry, children: [] })
    }

    const roots: KnowledgeTreeBranch[] = []
    for (const entry of categoryEntries) {
      const branch = branchById.get(entry.node.id)!
      const parentId = primaryParentId(entry, byId)
      const parent = parentId ? branchById.get(parentId) : undefined
      if (parent && parent !== branch) parent.children.push(branch)
      else roots.push(branch)
    }

    const sortBranch = (branch: KnowledgeTreeBranch) => {
      branch.children.sort((left, right) => compareEntries(left.entry, right.entry))
      branch.children.forEach(sortBranch)
    }
    roots.sort((left, right) => compareEntries(left.entry, right.entry))
    roots.forEach(sortBranch)

    return {
      category,
      label: categoryLabel(category),
      roots,
      ...summarize(categoryEntries)
    }
  })
}

export function filterKnowledgeTree(sections: KnowledgeTreeSection[], query: string): KnowledgeTreeSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return sections

  const filterBranch = (branch: KnowledgeTreeBranch): KnowledgeTreeBranch | null => {
    const children = branch.children.map(filterBranch).filter((item): item is KnowledgeTreeBranch => Boolean(item))
    const selfMatch = branch.entry.node.title.toLowerCase().includes(q)
      || branch.entry.node.description.toLowerCase().includes(q)
      || branch.entry.node.id.toLowerCase().includes(q)
      || branch.entry.node.tags.some(tag => tag.toLowerCase().includes(q))
    if (!selfMatch && !children.length) return null
    return { entry: branch.entry, children }
  }

  return sections.map(section => {
    const roots = section.roots.map(filterBranch).filter((item): item is KnowledgeTreeBranch => Boolean(item))
    if (!roots.length && !section.label.toLowerCase().includes(q) && !section.category.toLowerCase().includes(q)) {
      return null
    }
    const collect = (branches: KnowledgeTreeBranch[]): KnowledgePathNode[] => branches.flatMap(branch => [branch.entry, ...collect(branch.children)])
    const entries = collect(roots)
    return {
      ...section,
      roots,
      ...summarize(entries)
    }
  }).filter((section): section is KnowledgeTreeSection => Boolean(section))
}