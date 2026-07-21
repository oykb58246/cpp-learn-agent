import type { AchievementDefinition, LearnerAchievement, LearningEvent } from '@cpp-pet/contracts'

const definition = (
  id: string,
  title: string,
  eventType: LearningEvent['type'],
  threshold: number,
  xpReward: number,
  conceptId?: string
): AchievementDefinition => ({
  id,
  title,
  description: `通过可验证学习事件解锁“${title}”。`,
  icon: id,
  rule: { eventType, threshold, ...(conceptId ? { conceptId } : {}) },
  xpReward
})

export const achievementDefinitions: AchievementDefinition[] = [
  definition('environment-ready', '环境就绪', 'environment-ready', 1, 10),
  definition('first-build', '第一次构建', 'build-succeeded', 1, 10),
  definition('build-five', '构建熟手', 'build-succeeded', 5, 20),
  definition('build-twenty', '构建达人', 'build-succeeded', 20, 50),
  definition('first-test', '测试起步', 'test-passed', 1, 10),
  definition('test-ten', '回归守护', 'test-passed', 10, 40),
  definition('first-fix', '第一次修复', 'error-resolved', 1, 15),
  definition('fix-five', '排错新星', 'error-resolved', 5, 30),
  definition('fix-twenty', '诊断能手', 'error-resolved', 20, 60),
  definition('first-concept', '知识启航', 'concept-verified', 1, 10),
  definition('concept-ten', '基础扎实', 'concept-verified', 10, 40),
  definition('concept-thirty', '知识成林', 'concept-verified', 30, 100),
  definition('loop-master', '循环掌握', 'concept-verified', 1, 20, 'control.loops'),
  definition('review-first', '首次复习', 'review-completed', 1, 10),
  definition('review-ten', '温故知新', 'review-completed', 10, 40),
  definition('first-code-edit', '第一次有效编辑', 'code-edited', 1, 10),
  definition('code-edit-ten', '持续编写代码', 'code-edited', 10, 30),
  definition('practice-first-pass', 'OJ 初次通过', 'practice-passed', 1, 20),
  definition('practice-five-pass', '解题上手', 'practice-passed', 5, 50),
  definition('knowledge-first-mastered', '知识点通关', 'knowledge-mastered', 1, 15),
  definition('knowledge-ten-mastered', '通关十个知识点', 'knowledge-mastered', 10, 60),
  definition('project-first', '项目起步', 'project-completed', 1, 30),
  definition('project-five', '项目实践者', 'project-completed', 5, 80),
  definition('project-task-first', '项目任务完成', 'project-task-completed', 1, 25),
  definition('project-task-five', '项目任务实践者', 'project-task-completed', 5, 70)
]

export const reviewIntervalsDays = [1, 3, 7, 14, 30] as const

export function nextReviewDate(base: Date, intervalIndex: number): Date {
  const safeIndex = Math.max(0, Math.min(Math.trunc(intervalIndex), reviewIntervalsDays.length - 1))
  const days = reviewIntervalsDays[safeIndex] ?? reviewIntervalsDays.at(-1) ?? 30
  return new Date(base.getTime() + days * 86_400_000)
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / 100) + 1
}

export function growthStageForXp(xp: number): 1 | 2 | 3 | 4 {
  if (xp >= 1_000) return 4
  if (xp >= 500) return 3
  if (xp >= 200) return 2
  return 1
}

export class AchievementEngine {
  constructor(readonly definitions: AchievementDefinition[]) {}

  evaluate(
    event: LearningEvent,
    priorEvents: LearningEvent[],
    unlocked: LearnerAchievement[]
  ): AchievementDefinition[] {
    const unlockedIds = new Set(unlocked.map(item => item.achievementId))
    const allEvents = [...priorEvents, event]
    return this.definitions.filter(item => {
      if (unlockedIds.has(item.id)) return false
      const matches = allEvents.filter(candidate =>
        candidate.type === item.rule.eventType &&
        (!item.rule.conceptId || candidate.conceptIds.includes(item.rule.conceptId)))
      return matches.length >= item.rule.threshold
    })
  }
}
