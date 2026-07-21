import { describe, expect, it } from 'vitest'
import { builtInKnowledge } from './knowledge'
import { builtInPracticeExercises, builtInPracticeProjects } from './practice'

describe('built-in practice catalog', () => {
  it('organizes exercises by multiple knowledge points and ships five small projects', () => {
    expect(builtInPracticeExercises.length).toBeGreaterThanOrEqual(24)
    expect(new Set(builtInPracticeExercises.map(item => item.knowledgePoint)).size).toBeGreaterThanOrEqual(12)
    expect(builtInPracticeExercises.every(item => item.samples.length > 0 && item.conceptIds.length > 0)).toBe(true)
    expect(builtInPracticeExercises.every(item => item.judgeCases.length === 5 && item.judgeCases.every(test => test.score === 20))).toBe(true)
    expect([...new Set(builtInPracticeExercises.map(item => item.knowledgePoint))]).toEqual(expect.arrayContaining(['输入输出', '数组', '字符串', '递归', '二分查找', '队列与栈']))
    const knownConceptIds = new Set(builtInKnowledge.map(item => item.id))
    expect(builtInPracticeExercises.flatMap(item => item.conceptIds).every(id => knownConceptIds.has(id))).toBe(true)
    expect(builtInPracticeProjects).toHaveLength(5)
    expect(builtInPracticeProjects.every(item => item.goals.length >= 2 && item.suggestedFiles.includes('main.cpp'))).toBe(true)
  })
})