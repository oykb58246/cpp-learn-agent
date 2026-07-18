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
  rows: KnowledgePathNode[][]
}

const activeStatuses = new Set<LearnerKnowledge['status']>(['learning', 'self-claimed', 'verified', 'review'])

export function displayStatusFor(state: LearnerKnowledge | undefined): KnowledgePathStatus {
  if (!state || state.status === 'locked' || state.status === 'available') return 'locked'
  return state.status === 'learning' ? 'learning' : 'mastered'
}

export function buildKnowledgeLanes(catalog: KnowledgeNode[], knowledge: LearnerKnowledge[]): KnowledgePathLane[] {
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

  const entries: KnowledgePathNode[] = catalog.map(node => {
    const missingPrerequisiteIds = node.prerequisites.filter(id => !activeStatuses.has(states.get(id)?.status ?? 'locked'))
    return {
      node,
      status: displayStatusFor(states.get(node.id)),
      missingPrerequisiteIds,
      depth: depthOf(node.id),
      canAdvance: missingPrerequisiteIds.length === 0
    }
  })

  const categories = [...new Set(catalog.map(node => node.category))]
  const categoryIndex = new Map(categories.map((category, index) => [category, index]))
  const categoryDepth = new Map(categories.map(category => [
    category,
    Math.min(...entries.filter(entry => entry.node.category === category).map(entry => entry.depth))
  ]))

  return categories.sort((left, right) => {
    const byDepth = (categoryDepth.get(left) ?? 0) - (categoryDepth.get(right) ?? 0)
    return byDepth || (categoryIndex.get(left) ?? 0) - (categoryIndex.get(right) ?? 0)
  }).map(category => {
    const rows = new Map<number, KnowledgePathNode[]>()
    for (const entry of entries.filter(item => item.node.category === category)) {
      const row = rows.get(entry.depth) ?? []
      row.push(entry)
      rows.set(entry.depth, row)
    }
    return {
      category,
      rows: [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => row)
    }
  })
}
