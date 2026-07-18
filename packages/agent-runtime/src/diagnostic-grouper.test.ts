import { describe, expect, it } from 'vitest'
import type { Diagnostic, DiagnosticIncidentDetail, ProcessResult } from '@cpp-pet/contracts'
import {
  diagnosticFingerprint,
  groupDiagnostics,
  normalizeDiagnosticTemplate,
  projectInboxProjection,
  syntheticRuntimeDiagnostics
} from './diagnostic-grouper'

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  source: 'compiler', severity: 'error', rawMessage: "use of undeclared identifier 'count'",
  normalizedMessage: "use of undeclared identifier 'count'", relatedConceptIds: ['basics.variables'],
  ...overrides
})

const process = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  command: 'program.exe', args: [], exitCode: 1, stdout: '', stderr: '', durationMs: 20,
  timedOut: false, cancelled: false, outputTruncated: false, ...overrides
})

describe('diagnostic grouper', () => {
  it('normalizes paths, positions and changing quoted identifiers', () => {
    expect(normalizeDiagnosticTemplate("C:\\src\\main.cpp:8:5: use of undeclared identifier 'count'"))
      .toBe("<path>:<line>:<column>: use of undeclared identifier '<identifier>'")
    expect(normalizeDiagnosticTemplate("D:\\work\\main.cpp:21:3: use of undeclared identifier 'total'"))
      .toBe("<path>:<line>:<column>: use of undeclared identifier '<identifier>'")
  })

  it('groups same-root diagnostics and deduplicates the same occurrence', () => {
    const items = [
      diagnostic({ code: 'E0020', file: 'main.cpp', line: 8, column: 5 }),
      diagnostic({ code: 'E0020', file: 'main.cpp', line: 8, column: 5 }),
      diagnostic({ code: 'E0020', file: 'main.cpp', line: 21, column: 5, rawMessage: "use of undeclared identifier 'total'", normalizedMessage: "use of undeclared identifier 'total'" })
    ]
    const groups = groupDiagnostics(crypto.randomUUID(), 'compile', items)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.occurrenceCount).toBe(2)
    expect(groups[0]?.occurrences.map(item => item.line)).toEqual([8, 21])
  })

  it('keeps different codes and semantic templates separate', () => {
    const groups = groupDiagnostics(crypto.randomUUID(), 'compile', [
      diagnostic({ code: 'E0020' }),
      diagnostic({ code: 'E0021', normalizedMessage: 'expected ; before return', rawMessage: 'expected ; before return' }),
      diagnostic({ code: 'E0020', normalizedMessage: 'expected ; before return', rawMessage: 'expected ; before return' })
    ])
    expect(groups).toHaveLength(3)
    expect(diagnosticFingerprint('compile', diagnostic({ code: 'E0020' })))
      .not.toBe(diagnosticFingerprint('compile', diagnostic({ code: 'E0021' })))
  })

  it('creates bounded synthetic diagnostics for runtime failures', () => {
    expect(syntheticRuntimeDiagnostics(process({ exitCode: 124, timedOut: true }))).toMatchObject([
      { kind: 'timeout', diagnostic: { source: 'runtime', severity: 'error' } }
    ])
    expect(syntheticRuntimeDiagnostics(process({ exitCode: -11, stderr: 'segmentation fault' }))).toMatchObject([
      { kind: 'runtime', diagnostic: { rawMessage: expect.stringContaining('segmentation fault') } }
    ])
    expect(syntheticRuntimeDiagnostics(process({ exitCode: 0 }))).toEqual([])
  })

  it('merges active incident groups into one project inbox group', () => {
    const group = groupDiagnostics(crypto.randomUUID(), 'compile', [diagnostic({ file: 'a.cpp', line: 3 })])[0]!
    const second = groupDiagnostics(crypto.randomUUID(), 'compile', [diagnostic({ file: 'b.cpp', line: 9 })])[0]!
    const makeIncident = (id: string, item: typeof group): DiagnosticIncidentDetail => ({
      id, projectId: '11111111-1111-4111-8111-111111111111', attemptId: crypto.randomUUID(), targetKey: item.occurrences[0]?.file ?? 'unknown',
      operation: 'build', failureKinds: ['compile'], status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      groups: [item]
    })
    const projection = projectInboxProjection([makeIncident(crypto.randomUUID(), group), makeIncident(crypto.randomUUID(), second)])
    expect(projection).toHaveLength(1)
    expect(projection[0]?.occurrenceCount).toBe(2)
    expect(projection[0]?.occurrences.map(item => item.file)).toEqual(['a.cpp', 'b.cpp'])
  })
})
