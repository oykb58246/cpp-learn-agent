import { describe, expect, it } from 'vitest'
import type { LearnerKnowledge } from '@cpp-pet/contracts'
import { builtInKnowledge, KnowledgeGate, transitionKnowledge, validateKnowledgeGraph } from './knowledge'

const now = new Date().toISOString()

describe('KnowledgeGate', () => {
  it('ships at least 30 acyclic C++ concepts', () => {
    expect(builtInKnowledge.length).toBeGreaterThanOrEqual(30)
    expect(validateKnowledgeGraph(builtInKnowledge)).toEqual([])
  })

  it('allows known concepts and blocks concepts outside the prerequisite closure', () => {
    const states: LearnerKnowledge[] = [
      { userId: 'local-user', conceptId: 'basics.variables', status: 'verified', confidence: 1, verifiedAt: now, updatedAt: now },
      { userId: 'local-user', conceptId: 'control.conditions', status: 'verified', confidence: 1, verifiedAt: now, updatedAt: now },
      { userId: 'local-user', conceptId: 'control.loops', status: 'learning', confidence: 0.5, updatedAt: now }
    ]
    const gate = new KnowledgeGate(builtInKnowledge)

    expect(gate.check(['control.loops'], states).decision).toBe('allow')
    expect(gate.check(['stl.vector'], states)).toMatchObject({ decision: 'learn', blocked: ['stl.vector'] })
  })

  it('requests a rewrite when only an optional advanced concept is outside the boundary', () => {
    const state: LearnerKnowledge = {
      userId: 'local-user', conceptId: 'control.loops', status: 'verified', confidence: 1,
      verifiedAt: now, updatedAt: now
    }
    const result = new KnowledgeGate(builtInKnowledge).check(['control.loops', 'stl.algorithm'], [state], { allowRewrite: true })
    expect(result.decision).toBe('rewrite')
    expect(result.blocked).toContain('stl.algorithm')
  })

  it('only starts concepts whose prerequisites are already active', () => {
    expect(transitionKnowledge('local-user', builtInKnowledge, [], 'basics.program', 'learning').status).toBe('learning')
    expect(() => transitionKnowledge('local-user', builtInKnowledge, [], 'stl.vector', 'learning')).toThrow('前置概念')
    const prerequisites: LearnerKnowledge[] = [
      { userId: 'local-user', conceptId: 'generic.templates', status: 'learning', confidence: 0.5, updatedAt: now },
      { userId: 'local-user', conceptId: 'data.arrays', status: 'verified', confidence: 1, verifiedAt: now, updatedAt: now }
    ]
    expect(transitionKnowledge('local-user', builtInKnowledge, prerequisites, 'stl.vector', 'learning').status).toBe('learning')
  })

  it('allows self-claim only after a concept has entered learning', () => {
    expect(() => transitionKnowledge('local-user', builtInKnowledge, [], 'basics.program', 'self-claimed')).toThrow('学习中')
    const learning: LearnerKnowledge = { userId: 'local-user', conceptId: 'basics.program', status: 'learning', confidence: 0.5, updatedAt: now }
    expect(transitionKnowledge('local-user', builtInKnowledge, [learning], 'basics.program', 'self-claimed').status).toBe('self-claimed')
  })
})
