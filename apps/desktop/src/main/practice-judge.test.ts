import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PracticeExercise, ProcessResult, ToolchainProfile } from '@cpp-pet/contracts'
import { judgePracticeSubmission } from './practice-judge'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const processResult = (stdout = '', exitCode = 0): ProcessResult => ({
  command: 'program.exe', args: [], exitCode, stdout, stderr: '', durationMs: 5, timedOut: false, cancelled: false, outputTruncated: false
})

const profile: ToolchainProfile = {
  id: crypto.randomUUID(), family: 'gcc', version: '14.2.0', targetArch: 'x64', compilerPath: 'g++', capabilities: { compile: true, debug: false, compileDatabase: false }, verifiedAt: new Date().toISOString()
}

const exercise: PracticeExercise = {
  id: 'sum-five', title: '两数求和', knowledgePoint: '输入输出', conceptIds: ['basics.io'], difficulty: 1,
  statement: '输入两个整数，输出和。', constraints: ['-100 <= a,b <= 100'], samples: [{ input: '1 2', output: '3' }],
  judgeCases: Array.from({ length: 5 }, (_, index) => ({
    id: `case-${index + 1}`,
    input: `${index} ${index + 1}`,
    expectedOutput: `${index * 2 + 1}`,
    score: 20 as const,
    visibility: index === 0 ? 'sample' as const : 'hidden' as const
  })),
  source: 'built-in', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z'
}

describe('practice judge', () => {
  it('runs exactly five judge cases and scores 20 points per passed case', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpppilot-practice-judge-')); dirs.push(root)
    const outputs = new Map(exercise.judgeCases.map((item, index) => [item.input, index === 3 ? 'wrong\n' : `${item.expectedOutput}\r\n`]))

    const result = await judgePracticeSubmission(exercise, { exerciseId: exercise.id, code: 'int main(){}', standard: 'c++17', userId: 'local-user' }, {
      profile,
      workRoot: root,
      now: () => '2026-07-21T00:00:00.000Z',
      uuid: () => '11111111-1111-4111-8111-111111111111',
      toolchainService: {
        buildSingleFile: async () => ({ artifactPath: join(root, 'program.exe'), success: true, diagnostics: [], process: processResult('', 0) })
      },
      runExecutable: async (_artifact, _args, options) => processResult(outputs.get(String(options.input ?? '').trim()) ?? '')
    })

    expect(result).toMatchObject({ status: 'wrong-answer', score: 80, totalScore: 100, passed: false })
    expect(result.cases).toHaveLength(5)
    expect(result.cases.map(item => item.score)).toEqual([20, 20, 20, 0, 20])
  })

  it('returns a compile-error submission without running judge cases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpppilot-practice-judge-')); dirs.push(root)
    let runCount = 0

    const result = await judgePracticeSubmission(exercise, { exerciseId: exercise.id, code: 'broken', standard: 'c++17', userId: 'local-user' }, {
      profile,
      workRoot: root,
      now: () => '2026-07-21T00:00:00.000Z',
      uuid: () => '22222222-2222-4222-8222-222222222222',
      toolchainService: {
        buildSingleFile: async () => ({ artifactPath: join(root, 'program.exe'), success: false, diagnostics: [], process: { ...processResult('', 1), command: 'g++', stderr: 'compile failed' } })
      },
      runExecutable: async () => { runCount += 1; return processResult('', 0) }
    })

    expect(result).toMatchObject({ status: 'compile-error', score: 0, totalScore: 100, passed: false })
    expect(result.cases).toEqual([])
    expect(runCount).toBe(0)
  })
})