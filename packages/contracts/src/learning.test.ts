import { describe, expect, it } from 'vitest'
import {
  achievementDefinitionSchema,
  backgroundProfileSchema,
  errorBookEntrySchema,
  knowledgeNodeSchema,
  learnerKnowledgeSchema,
  learningEventSchema
} from './learning'

const now = new Date().toISOString()

describe('H3 learning contracts', () => {
  it('validates a self-reported assistant background profile', () => {
    const profile = backgroundProfileSchema.parse({
      userId: 'local-user',
      onboardingCompleted: true,
      startingPoint: 'some-experience',
      studiedConceptIds: ['basics.program', 'basics.variables'],
      focusConceptIds: ['control.loops'],
      updatedAt: now
    })

    expect(profile.studiedConceptIds).toEqual(['basics.program', 'basics.variables'])
    expect(profile.focusConceptIds).toEqual(['control.loops'])
    expect(backgroundProfileSchema.safeParse({ ...profile, startingPoint: 'verified' }).success).toBe(false)
  })

  it('validates knowledge nodes and learner states', () => {
    const node = knowledgeNodeSchema.parse({
      id: 'control.loops',
      title: '循环',
      description: '使用循环重复执行代码',
      category: 'control-flow',
      difficulty: 1,
      prerequisites: ['control.conditions'],
      tags: ['for', 'while']
    })
    const state = learnerKnowledgeSchema.parse({
      userId: 'local-user',
      conceptId: node.id,
      status: 'learning',
      confidence: 0.4,
      updatedAt: now
    })
    expect(state.status).toBe('learning')
    expect(learnerKnowledgeSchema.safeParse({ ...state, confidence: 2 }).success).toBe(false)
  })

  it('requires evidence and a stable source id for learning rewards', () => {
    const event = learningEventSchema.parse({
      id: crypto.randomUUID(),
      sourceEventId: 'run:1:validation:2',
      userId: 'local-user',
      type: 'error-resolved',
      conceptIds: ['control.loops'],
      xp: 20,
      evidence: { kind: 'build', referenceId: 'build-1', summary: '回归编译通过' },
      occurredAt: now
    })
    expect(event.xp).toBe(20)
    expect(learningEventSchema.safeParse({ ...event, evidence: undefined }).success).toBe(false)
  })

  it('records failed review evidence without awarding XP', () => {
    const event = learningEventSchema.parse({
      id: crypto.randomUUID(), sourceEventId: 'review-failed-1', userId: 'local-user',
      type: 'review-failed', conceptIds: ['control.loops'], xp: 0,
      evidence: { kind: 'review', referenceId: 'review-1', summary: '边界条件回答不完整' },
      occurredAt: now
    })

    expect(event.type).toBe('review-failed')
    expect(event.xp).toBe(0)
  })

  it('validates error book evidence and deterministic achievements', () => {
    expect(errorBookEntrySchema.safeParse({
      id: crypto.randomUUID(),
      userId: 'local-user',
      category: 'compile',
      title: '循环变量未声明',
      evidence: 'main.cpp:3: i was not declared',
      conceptIds: ['control.loops'],
      status: 'open',
      occurrences: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      nextReviewAt: now
    }).success).toBe(true)
    expect(achievementDefinitionSchema.safeParse({
      id: 'first-fix',
      title: '第一次修复',
      description: '首次通过验证修复错误',
      icon: 'wrench',
      rule: { eventType: 'error-resolved', threshold: 1 },
      xpReward: 10
    }).success).toBe(true)
  })
})
