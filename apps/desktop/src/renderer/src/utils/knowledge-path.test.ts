import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'
import {
  buildKnowledgeLanes,
  buildKnowledgeTree,
  categoryLabel,
  displayStatusFor,
  filterKnowledgeLanes,
  filterKnowledgeTree
} from './knowledge-path'

const now = '2026-07-18T00:00:00.000Z'
const node = (id: string, category: string, prerequisites: string[] = []): KnowledgeNode => ({
  id, title: id, description: id, category, difficulty: 1, prerequisites, tags: []
})

describe('knowledge path projection', () => {
  it('maps review and verified records to the mastered display state', () => {
    expect(displayStatusFor(undefined)).toBe('locked')
    expect(displayStatusFor({ userId: 'local-user', conceptId: 'a', status: 'learning', confidence: 0.5, updatedAt: now })).toBe('learning')
    expect(displayStatusFor({ userId: 'local-user', conceptId: 'a', status: 'review', confidence: 0.8, updatedAt: now })).toBe('mastered')
  })

  it('groups same-depth siblings as parallel and identifies blocked prerequisites', () => {
    const catalog = [node('finish', 'advanced', ['left', 'right']), node('left', 'branches', ['root']), node('root', 'basics'), node('right', 'branches', ['root'])]
    const knowledge: LearnerKnowledge[] = [{ userId: 'local-user', conceptId: 'root', status: 'self-claimed', confidence: 0.7, updatedAt: now }]
    const lanes = buildKnowledgeLanes(catalog, knowledge)
    const branch = lanes.find(lane => lane.category === 'branches')!
    const finish = lanes.find(lane => lane.category === 'advanced')!.rows[0]![0]!

    expect(lanes.map(lane => lane.category)).toEqual(['basics', 'branches', 'advanced'])
    expect(branch.rows[0]!.map(item => item.node.id)).toEqual(['left', 'right'])
    expect(finish.missingPrerequisiteIds).toEqual(['left', 'right'])
    expect(finish.canAdvance).toBe(false)
  })

  it('builds a single-page forest ordered by learning depth and category parents', () => {
    const catalog = [
      node('root', 'basics'),
      node('left', 'branches', ['root']),
      node('right', 'branches', ['root']),
      node('finish', 'advanced', ['left', 'right'])
    ]
    const knowledge: LearnerKnowledge[] = [
      { userId: 'local-user', conceptId: 'root', status: 'self-claimed', confidence: 0.7, updatedAt: now }
    ]
    const tree = buildKnowledgeTree(catalog, knowledge)

    expect(tree.map(section => section.category)).toEqual(['basics', 'branches', 'advanced'])
    expect(tree[0]?.label).toBe(categoryLabel('basics'))
    expect(tree[1]?.roots.map(item => item.entry.node.id).sort()).toEqual(['left', 'right'])
    expect(tree[1]?.roots.every(item => item.children.length === 0)).toBe(true)
    expect(tree[2]?.roots[0]?.entry.missingPrerequisiteIds).toEqual(['left', 'right'])
  })

  it('nests same-category prerequisites as tree children', () => {
    const catalog = [
      node('basics.program', 'basics'),
      node('basics.variables', 'basics', ['basics.program']),
      node('basics.types', 'basics', ['basics.variables'])
    ]
    const tree = buildKnowledgeTree(catalog, [])
    const basics = tree.find(section => section.category === 'basics')!
    expect(basics.roots).toHaveLength(1)
    expect(basics.roots[0]?.entry.node.id).toBe('basics.program')
    expect(basics.roots[0]?.children[0]?.entry.node.id).toBe('basics.variables')
    expect(basics.roots[0]?.children[0]?.children[0]?.entry.node.id).toBe('basics.types')
  })

  it('filters the forest without splitting into multiple pages', () => {
    const catalog = [
      node('basics.program', 'basics'),
      node('basics.variables', 'basics', ['basics.program']),
      node('control.loops', 'control-flow', ['basics.program'])
    ]
    const tree = buildKnowledgeTree(catalog, [])
    const filtered = filterKnowledgeTree(tree, 'variables')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.category).toBe('basics')
    expect(filtered[0]?.roots[0]?.entry.node.id).toBe('basics.program')
    expect(filtered[0]?.roots[0]?.children[0]?.entry.node.id).toBe('basics.variables')
  })
  it('builds staged constellation lanes with depth rows', () => {
    const catalog = [
      node('root', 'basics'),
      node('child', 'basics', ['root']),
      node('data-a', 'data', ['root'])
    ]
    const lanes = buildKnowledgeLanes(catalog, [])
    expect(lanes[0]?.label).toBe(categoryLabel('basics'))
    expect(lanes[0]?.stage).toBe(1)
    expect(lanes[0]?.rows[0]?.map(item => item.node.id)).toEqual(['root'])
    expect(lanes[0]?.rows[1]?.map(item => item.node.id)).toEqual(['child'])
    expect(filterKnowledgeLanes(lanes, 'data-a')).toHaveLength(1)
  })
})