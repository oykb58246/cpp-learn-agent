import type { DiagnosticExplanationSnapshot, DiagnosticInboxGroup } from '@cpp-pet/contracts'

export function diagnosticBadgeLabel(count: number): string {
  return count > 99 ? '99+' : String(Math.max(0, count))
}

export function nextExpandedFingerprint(current: string | null, selected: string): string | null {
  return current === selected ? null : selected
}

export function toDiagnosticSnapshot(group: DiagnosticInboxGroup): DiagnosticExplanationSnapshot {
  return {
    fingerprint: group.fingerprint,
    title: group.title,
    failureKind: group.failureKind,
    occurrenceCount: group.occurrenceCount,
    occurrences: group.occurrences.map(occurrence => ({ ...occurrence })),
    incidentIds: [...group.incidentIds]
  }
}
