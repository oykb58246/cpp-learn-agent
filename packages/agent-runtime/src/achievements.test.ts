import { describe, expect, it } from 'vitest'
import type { LearningEvent } from '@cpp-pet/contracts'
import {
  AchievementEngine,
  achievementDefinitions,
  growthStageForXp,
  levelForXp,
  nextReviewDate
} from './achievements'

const base = new Date('2026-07-16T00:00:00.000Z')

describe('deterministic learning growth', () => {
  it('uses 1, 3, 7, 14 and 30 day review intervals', () => {
    expect([0, 1, 2, 3, 4].map(index => nextReviewDate(base, index).toISOString().slice(0, 10)))
      .toEqual(['2026-07-17', '2026-07-19', '2026-07-23', '2026-07-30', '2026-08-15'])
  })

  it('ships at least 15 unique deterministic achievements', () => {
    expect(achievementDefinitions.length).toBeGreaterThanOrEqual(15)
    expect(new Set(achievementDefinitions.map(item => item.id)).size).toBe(achievementDefinitions.length)
  })

  it('awards achievements from evidence events and never from chat count', () => {
    const event: LearningEvent = {
      id: crypto.randomUUID(), sourceEventId: 'run:1:validation', userId: 'local-user',
      type: 'error-resolved', conceptIds: ['control.loops'], xp: 20,
      evidence: { kind: 'build', referenceId: 'build-1', summary: '回归构建通过' },
      occurredAt: base.toISOString()
    }
    const result = new AchievementEngine(achievementDefinitions).evaluate(event, [], [])
    expect(result.map(item => item.id)).toContain('first-fix')
    expect(achievementDefinitions.some(item => item.rule.eventType === 'chat-message')).toBe(false)
  })

  it('covers code editing, OJ passing, knowledge mastery and project task achievements', () => {
    const engine = new AchievementEngine(achievementDefinitions)
    const eventTypes: LearningEvent['type'][] = ['code-edited', 'practice-passed', 'knowledge-mastered', 'project-task-completed']

    for (const type of eventTypes) {
      const event: LearningEvent = {
        id: crypto.randomUUID(), sourceEventId: `event:${type}`, userId: 'local-user',
        type, conceptIds: ['control.loops'], xp: 10,
        evidence: { kind: type === 'code-edited' ? 'editor' : type === 'project-task-completed' ? 'project' : 'practice', referenceId: `ref:${type}`, summary: type },
        occurredAt: base.toISOString()
      }
      expect(engine.evaluate(event, [], []).some(item => item.rule.eventType === type && item.xpReward > 0)).toBe(true)
    }
  })
  it('derives stable levels and four growth stages from XP', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(250)).toBe(3)
    expect([0, 200, 500, 1_000].map(growthStageForXp)).toEqual([1, 2, 3, 4])
  })
})
