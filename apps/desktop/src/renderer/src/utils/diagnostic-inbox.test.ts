import { describe, expect, it } from 'vitest'
import type { DiagnosticInboxGroup } from '@cpp-pet/contracts'
import { diagnosticBadgeLabel, nextExpandedFingerprint, toDiagnosticSnapshot } from './diagnostic-inbox'

const group: DiagnosticInboxGroup = {
  fingerprint: 'fingerprint',
  title: '缺少分号',
  source: 'compiler',
  code: 'EXPECTED_SEMICOLON',
  failureKind: 'compile',
  severity: 'error',
  occurrenceCount: 2,
  incidentIds: [crypto.randomUUID()],
  occurrences: [
    {
      id: crypto.randomUUID(), groupId: crypto.randomUUID(), file: 'main.cpp', line: 2, column: 5,
      rawMessage: "expected ';'", normalizedMessage: "expected ';'"
    }
  ]
}

describe('diagnostic inbox helpers', () => {
  it('caps badge labels and toggles one expanded group', () => {
    expect(diagnosticBadgeLabel(4)).toBe('4')
    expect(diagnosticBadgeLabel(120)).toBe('99+')
    expect(nextExpandedFingerprint(null, 'a')).toBe('a')
    expect(nextExpandedFingerprint('a', 'a')).toBeNull()
    expect(nextExpandedFingerprint('a', 'b')).toBe('b')
  })

  it('creates an immutable diagnostic explanation snapshot', () => {
    const snapshot = toDiagnosticSnapshot(group)
    expect(snapshot).toMatchObject({
      fingerprint: group.fingerprint,
      title: group.title,
      failureKind: 'compile',
      occurrenceCount: 2,
      incidentIds: group.incidentIds
    })
    expect(snapshot.occurrences).not.toBe(group.occurrences)
    expect(snapshot.occurrences[0]).not.toBe(group.occurrences[0])
  })
})
