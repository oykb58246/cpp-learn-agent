import { describe, expect, it } from 'vitest'
import type { BackgroundProfile, LearnerKnowledge } from '@cpp-pet/contracts'
import { buildExplanationContext, builtInKnowledge, collectKnowledgePath, KnowledgeGate, transitionKnowledge, unlockKnowledgePath, validateKnowledgeGraph } from './knowledge'

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

  it('allows an eligible concept to be self-claimed directly and reset to locked', () => {
    const prerequisites: LearnerKnowledge[] = [{
      userId: 'local-user', conceptId: 'basics.program', status: 'self-claimed',
      confidence: 0.7, updatedAt: now
    }]

    expect(transitionKnowledge('local-user', builtInKnowledge, prerequisites, 'basics.io', 'self-claimed').status)
      .toBe('self-claimed')
    expect(transitionKnowledge('local-user', builtInKnowledge, prerequisites, 'basics.io', 'locked').status)
      .toBe('locked')
    expect(() => transitionKnowledge('local-user', builtInKnowledge, [], 'basics.io', 'self-claimed'))
      .toThrow('前置概念')
  })
})

describe('explanation context', () => {
  it('marks unfamiliar requested concepts for introduction without blocking the explanation', () => {
    const profile: BackgroundProfile = {
      userId: 'local-user',
      onboardingCompleted: true,
      startingPoint: 'some-experience',
      studiedConceptIds: ['basics.program', 'basics.variables'],
      focusConceptIds: ['control.loops'],
      updatedAt: now
    }

    const context = buildExplanationContext(builtInKnowledge, profile, ['data.arrays'])

    expect(context.knownConceptIds).toEqual(['basics.program', 'basics.variables'])
    expect(context.focusConceptIds).toEqual(['control.loops'])
    expect(context.unseenConceptIds).toEqual(['data.arrays'])
    expect(context.instructions).toContain('先用简短定义介绍未接触概念')
  })
  it('unlocks the full prerequisite path to a target concept', () => {
    const path = collectKnowledgePath(builtInKnowledge, 'control.loops')
    expect(path[0]).toBe('basics.program')
    expect(path.at(-1)).toBe('control.loops')
    const unlocked = unlockKnowledgePath('local-user', builtInKnowledge, [], 'control.loops', 'self-claimed')
    expect(unlocked.map(item => item.conceptId)).toEqual(path)
    expect(unlocked.every(item => item.status === 'self-claimed')).toBe(true)
  })
})
