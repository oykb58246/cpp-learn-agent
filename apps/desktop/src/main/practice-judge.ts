import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PracticeExercise, PracticeSubmissionRequest, PracticeSubmissionResult, ProcessResult, ToolchainProfile } from '@cpp-pet/contracts'
import { runProcess, runtimeDiagnostics, type SingleFileBuildOptions, type SingleFileBuildResult } from '@cpp-pet/cpp-local-tools'

type RunExecutable = (command: string, args: string[], options: { cwd?: string; input?: string; timeoutMs?: number; maxOutputBytes?: number; capturePeakMemory?: boolean; signal?: AbortSignal }) => Promise<ProcessResult>
const PRACTICE_TIME_LIMIT_MS = 3_000

export interface PracticeJudgeDependencies {
  profile: ToolchainProfile
  workRoot: string
  toolchainService: {
    buildSingleFile(options: SingleFileBuildOptions): Promise<SingleFileBuildResult>
  }
  runExecutable?: RunExecutable
  now?: () => string
  uuid?: () => string
  signal?: AbortSignal
}

export async function judgePracticeSubmission(
  exercise: PracticeExercise,
  request: PracticeSubmissionRequest,
  dependencies: PracticeJudgeDependencies
): Promise<PracticeSubmissionResult> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const userId = request.userId ?? 'local-user'
  const uuid = dependencies.uuid ?? randomUUID
  const runExecutable = dependencies.runExecutable ?? runProcess
  mkdirSync(dependencies.workRoot, { recursive: true })
  const workingDirectory = mkdtempSync(join(dependencies.workRoot, 'practice-'))
  const sourcePath = join(workingDirectory, 'main.cpp')
  const outputDirectory = join(workingDirectory, 'build')
  writeFileSync(sourcePath, request.code, 'utf8')

  try {
    const buildOptions: SingleFileBuildOptions = {
      profile: dependencies.profile,
      projectRoot: workingDirectory,
      sourcePath,
      sourceRelativePath: 'main.cpp',
      outputDirectory
    }
    if (request.standard) buildOptions.standard = request.standard
    if (dependencies.signal) buildOptions.signal = dependencies.signal
    const build = await dependencies.toolchainService.buildSingleFile(buildOptions)
    const submittedAt = now()
    const compile = { success: build.success, diagnostics: build.diagnostics, process: build.process }
    if (!build.success) {
      return {
        submissionId: uuid(),
        exerciseId: exercise.id,
        userId,
        status: 'compile-error',
        score: 0,
        totalScore: 100,
        passed: false,
        submittedAt,
        compile,
        cases: []
      }
    }

    const cases: PracticeSubmissionResult['cases'] = []
    for (const item of exercise.judgeCases.slice(0, 5)) {
      const runOptions: Parameters<RunExecutable>[2] = {
        cwd: workingDirectory,
        input: item.input,
        timeoutMs: PRACTICE_TIME_LIMIT_MS,
        maxOutputBytes: 20_000,
        capturePeakMemory: true
      }
      if (dependencies.signal) runOptions.signal = dependencies.signal
      const process = await runExecutable(build.artifactPath, [], runOptions)
      const runtimeErrors = runtimeDiagnostics(process)
      const passed = runtimeErrors.length === 0 && normalizeJudgeOutput(process.stdout) === normalizeJudgeOutput(item.expectedOutput)
      cases.push({
        caseId: item.id,
        visibility: item.visibility,
        input: item.input,
        expectedOutput: item.expectedOutput,
        actualOutput: truncateForContract(process.stdout),
        stderr: truncateForContract(process.stderr),
        passed,
        score: passed ? 20 : 0,
        durationMs: process.durationMs,
        ...(process.peakMemoryBytes !== undefined ? { peakMemoryBytes: process.peakMemoryBytes } : {}),
        exitCode: process.exitCode,
        timedOut: process.timedOut,
        ...(runtimeErrors[0]?.normalizedMessage ? { errorMessage: runtimeErrors[0].normalizedMessage } : {})
      })
    }
    const score = cases.reduce((total, item) => total + item.score, 0)
    const status = practiceVerdict(cases)
    return {
      submissionId: uuid(),
      exerciseId: exercise.id,
      userId,
      status,
      score,
      totalScore: 100,
      passed: score === 100,
      submittedAt,
      compile,
      cases
    }
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true })
  }
}

export function normalizeJudgeOutput(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '')
}

function truncateForContract(value: string): string {
  return value.length > 20_000 ? value.slice(0, 20_000) : value
}

function practiceVerdict(cases: PracticeSubmissionResult['cases']): PracticeSubmissionResult['status'] {
  if (cases.every(item => item.passed)) return 'accepted'
  if (cases.some(item => item.timedOut)) return 'time-limit-exceeded'
  if (cases.some(item => isMemoryFailure(item.stderr, item.errorMessage))) return 'memory-limit-exceeded'
  if (cases.some(item => item.exitCode !== 0)) return 'runtime-error'
  return 'wrong-answer'
}

function isMemoryFailure(stderr: string, errorMessage?: string): boolean {
  return /bad_alloc|out of memory|cannot allocate memory|not enough memory|memory allocation/i.test(`${stderr}\n${errorMessage ?? ''}`)
}
