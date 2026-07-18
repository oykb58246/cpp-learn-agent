import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnerKnowledge } from '@cpp-pet/contracts'
import { buildKnowledgeLanes, displayStatusFor } from './knowledge-path'

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
    const catalog = [node('root', 'basics'), node('left', 'branches', ['root']), node('right', 'branches', ['root']), node('finish', 'advanced', ['left', 'right'])]
    const knowledge: LearnerKnowledge[] = [{ userId: 'local-user', conceptId: 'root', status: 'self-claimed', confidence: 0.7, updatedAt: now }]
    const lanes = buildKnowledgeLanes(catalog, knowledge)
    const branch = lanes.find(lane => lane.category === 'branches')!
    const finish = lanes.find(lane => lane.category === 'advanced')!.rows[0]![0]!

    expect(branch.rows[0]!.map(item => item.node.id)).toEqual(['left', 'right'])
    expect(finish.missingPrerequisiteIds).toEqual(['left', 'right'])
    expect(finish.canAdvance).toBe(false)
  })
})
