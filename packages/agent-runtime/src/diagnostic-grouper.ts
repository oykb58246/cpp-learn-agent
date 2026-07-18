import { createHash, randomUUID } from 'node:crypto'
import type {
  Diagnostic,
  DiagnosticFailureKind,
  DiagnosticIncidentDetail,
  DiagnosticInboxGroup,
  DiagnosticOccurrence,
  ProcessResult
} from '@cpp-pet/contracts'

const cppKeywords = new Set([
  'alignas', 'alignof', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr',
  'continue', 'decltype', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export', 'extern',
  'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'noexcept',
  'nullptr', 'operator', 'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short',
  'signed', 'sizeof', 'static', 'static_cast', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try',
  'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while'
])

const pathWithLocation = /(?:[A-Za-z]:[\\/]|\/)(?:[^:\r\n\\/]+[\\/])*[^:\r\n]+(?=:\d+:\d+)/g
const location = /:\d+:\d+/g
const quotedIdentifier = /(['"`])([A-Za-z_]\w*)\1/g

export function normalizeDiagnosticTemplate(message: string): string {
  return message
    .replaceAll('\r\n', '\n')
    .replace(pathWithLocation, '<path>')
    .replace(location, ':<line>:<column>')
    .replace(/\b(?:pid|process(?:\s+id)?)\s*[=:]?\s*\d+\b/gi, 'process <id>')
    .replace(/0x[0-9a-f]+/gi, '<address>')
    .replace(quotedIdentifier, (full, quote: string, value: string) => cppKeywords.has(value) ? full : `${quote}<identifier>${quote}`)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
}

export function diagnosticFingerprint(kind: DiagnosticFailureKind, diagnostic: Diagnostic): string {
  const template = normalizeDiagnosticTemplate(diagnostic.normalizedMessage || diagnostic.rawMessage)
  return createHash('sha256')
    .update([kind, diagnostic.source, diagnostic.code ?? '', template].join('|'))
    .digest('hex')
}

export function groupDiagnostics(incidentId: string, kind: DiagnosticFailureKind, diagnostics: Diagnostic[]): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>()
  for (const diagnostic of diagnostics) {
    const fingerprint = diagnosticFingerprint(kind, diagnostic)
    const template = normalizeDiagnosticTemplate(diagnostic.normalizedMessage || diagnostic.rawMessage)
    const existing = groups.get(fingerprint)
    if (existing) {
      const occurrence = occurrenceFor(existing.id, diagnostic)
      if (!existing.occurrences.some(item => sameOccurrence(item, occurrence))) existing.occurrences.push(occurrence)
      existing.occurrenceCount = existing.occurrences.length
      continue
    }
    const id = randomUUID()
    groups.set(fingerprint, {
      id,
      incidentId,
      fingerprint,
      source: diagnostic.source,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      failureKind: kind,
      severity: diagnostic.severity,
      title: titleFor(diagnostic, template),
      normalizedTemplate: template,
      occurrenceCount: 1,
      createdAt: new Date().toISOString(),
      occurrences: [occurrenceFor(id, diagnostic)]
    })
  }
  return [...groups.values()].map(group => ({
    ...group,
    occurrences: group.occurrences.sort(compareOccurrences),
    occurrenceCount: group.occurrences.length
  }))
}

export function syntheticRuntimeDiagnostics(process: ProcessResult): Array<{ kind: DiagnosticFailureKind; diagnostic: Diagnostic }> {
  if (process.cancelled || (process.exitCode === 0 && !process.timedOut)) return []
  const output = `${process.stderr}\n${process.stdout}`.trim().slice(0, 2_000)
  if (process.timedOut) return [{ kind: 'timeout', diagnostic: synthetic('程序运行超时', output) }]
  if (process.exitCode !== null && process.exitCode < 0) return [{ kind: 'runtime', diagnostic: synthetic(output || `程序异常退出（信号 ${process.exitCode}）`, output) }]
  return [{ kind: 'nonzero-exit', diagnostic: synthetic(output || `程序以退出码 ${process.exitCode ?? '未知'} 结束`, output) }]
}

export function projectInboxProjection(incidents: DiagnosticIncidentDetail[]): DiagnosticInboxGroup[] {
  const projected = new Map<string, DiagnosticInboxGroup>()
  for (const incident of incidents.filter(item => item.status === 'active')) {
    for (const group of incident.groups) {
      const existing = projected.get(group.fingerprint)
      if (!existing) {
        projected.set(group.fingerprint, {
          fingerprint: group.fingerprint,
          title: group.title,
          source: group.source,
          ...(group.code ? { code: group.code } : {}),
          failureKind: group.failureKind,
          severity: group.severity,
          occurrenceCount: group.occurrences.length,
          occurrences: [...group.occurrences].sort(compareOccurrences),
          incidentIds: [incident.id]
        })
        continue
      }
      if (!existing.incidentIds.includes(incident.id)) existing.incidentIds.push(incident.id)
      for (const occurrence of group.occurrences) {
        if (!existing.occurrences.some(item => sameOccurrence(item, occurrence))) existing.occurrences.push(occurrence)
      }
      existing.occurrences.sort(compareOccurrences)
      existing.occurrenceCount = existing.occurrences.length
    }
  }
  return [...projected.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.title.localeCompare(b.title))
}

interface DiagnosticGroup {
  id: string
  incidentId: string
  fingerprint: string
  source: Diagnostic['source']
  code?: string
  failureKind: DiagnosticFailureKind
  severity: Diagnostic['severity']
  title: string
  normalizedTemplate: string
  occurrenceCount: number
  createdAt: string
  occurrences: DiagnosticOccurrence[]
}

function occurrenceFor(groupId: string, diagnostic: Diagnostic): DiagnosticOccurrence {
  return {
    id: randomUUID(), groupId,
    ...(diagnostic.file ? { file: diagnostic.file.replaceAll('\\', '/') } : {}),
    ...(diagnostic.line ? { line: diagnostic.line } : {}),
    ...(diagnostic.column ? { column: diagnostic.column } : {}),
    rawMessage: diagnostic.rawMessage.slice(0, 20_000),
    normalizedMessage: normalizeDiagnosticTemplate(diagnostic.normalizedMessage || diagnostic.rawMessage).slice(0, 20_000)
  }
}

function sameOccurrence(left: DiagnosticOccurrence, right: DiagnosticOccurrence): boolean {
  return left.file === right.file && left.line === right.line && left.column === right.column && left.rawMessage === right.rawMessage
}

function compareOccurrences(left: DiagnosticOccurrence, right: DiagnosticOccurrence): number {
  return (left.file ?? '').localeCompare(right.file ?? '') || (left.line ?? 0) - (right.line ?? 0) || (left.column ?? 0) - (right.column ?? 0)
}

function titleFor(diagnostic: Diagnostic, template: string): string {
  if (diagnostic.code) return `${diagnostic.code}: ${template}`
  return template
}

function synthetic(title: string, evidence: string): Diagnostic {
  return {
    source: 'runtime', severity: 'error', rawMessage: title + (evidence ? `\n${evidence}` : ''),
    normalizedMessage: title, relatedConceptIds: []
  }
}
