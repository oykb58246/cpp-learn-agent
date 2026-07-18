import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BuildRequest, BuildResult, Diagnostic, ProcessResult, ProgramRunResult } from '@cpp-pet/contracts'
import { AppDatabase } from '@cpp-pet/database'
import { DiagnosticIncidentService } from './diagnostic-incident-service'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cpppet-incidents-')); dirs.push(dir)
  const db = new AppDatabase(join(dir, 'app.sqlite'))
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  const projectId = crypto.randomUUID()
  db.upsertWorkspace({ id: workspaceId, name: 'Lab', rootPath: dir, trustState: 'trusted', createdAt: now, lastOpenedAt: now })
  db.saveProject({ id: projectId, workspaceId, name: 'Demo', type: 'single-file', creationMode: 'manual', relativeRoot: 'demo', createdAt: now, updatedAt: now, lastOpenedAt: now })
  return { db, projectId, service: new DiagnosticIncidentService(db, () => now) }
}

const process = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  command: 'g++', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 10,
  timedOut: false, cancelled: false, outputTruncated: false, ...overrides
})

const compilerError = (line: number): Diagnostic => ({
  source: 'compiler', severity: 'error', code: 'EXPECTED_SEMICOLON', file: 'main.cpp', line, column: 5,
  rawMessage: "expected ';' before 'return'", normalizedMessage: "expected ';' before 'return'", relatedConceptIds: ['basics.program']
})

function build(projectId: string, success: boolean, diagnostics = [compilerError(2)]): { input: BuildRequest; result: BuildResult } {
  const runId = crypto.randomUUID()
  const input = { runId, projectId, relativePath: 'main.cpp', standard: 'c++17' as const }
  return { input, result: {
    runId, buildId: crypto.randomUUID(), projectId, relativePath: 'main.cpp', profileId: crypto.randomUUID(), success,
    artifactName: 'main.exe', process: process({ exitCode: success ? 0 : 1 }), diagnostics: success ? [] : diagnostics, builtAt: new Date().toISOString()
  } }
}

describe('DiagnosticIncidentService', () => {
  it('records grouped compiler failures and publishes project inbox changes', () => {
    const { db, projectId, service } = setup()
    const events: number[] = []
    service.onChanged(event => events.push(event.groups.length))
    const item = build(projectId, false, [compilerError(2), compilerError(8)])
    const groups = service.recordBuild(item.input, item.result)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.occurrenceCount).toBe(2)
    expect(events).toEqual([1])
    db.close()
  })

  it('does not record cancelled executions and acknowledges without resolving', () => {
    const { db, projectId, service } = setup()
    const item = build(projectId, false)
    item.result.process.cancelled = true
    expect(service.recordBuild(item.input, item.result)).toEqual([])
    const failed = build(projectId, false)
    service.recordBuild(failed.input, failed.result)
    expect(service.acknowledge(projectId).attention).toBe(false)
    expect(service.list(projectId).groups).toHaveLength(1)
    db.close()
  })

  it('resolves build and runtime failures only after the corresponding success', () => {
    const { db, projectId, service } = setup()
    const failedBuild = build(projectId, false)
    service.recordBuild(failedBuild.input, failedBuild.result)
    const target = { projectId, relativePath: 'main.cpp', standard: 'c++17' as const }
    const failedRun: ProgramRunResult = {
      runId: crypto.randomUUID(), buildId: crypto.randomUUID(), success: false,
      process: process({ command: 'main.exe', timedOut: true, exitCode: 124 }), diagnostics: []
    }
    service.recordRun(target, failedRun)
    expect(service.list(projectId).groups).toHaveLength(2)

    const successfulBuild = build(projectId, true)
    service.recordBuild(successfulBuild.input, successfulBuild.result)
    expect(service.list(projectId).groups.map(item => item.failureKind)).toEqual(['timeout'])
    service.recordRun(target, { ...failedRun, success: true, process: process({ command: 'main.exe', exitCode: 0 }), diagnostics: [] })
    expect(service.list(projectId).groups).toEqual([])
    db.close()
  })
})
