import { randomUUID } from 'node:crypto'
import type {
  BuildRequest,
  BuildResult,
  CppStandard,
  Diagnostic,
  DiagnosticFailureKind,
  DiagnosticInboxChangedEvent,
  DiagnosticInboxGroup,
  ProgramRunResult
} from '@cpp-pet/contracts'
import { groupDiagnostics, projectInboxProjection, syntheticRuntimeDiagnostics } from '@cpp-pet/agent-runtime'
import { AppDatabase } from '@cpp-pet/database'

export class DiagnosticIncidentService {
  private readonly listeners = new Set<(event: DiagnosticInboxChangedEvent) => void>()

  constructor(private readonly db: AppDatabase, private readonly now: () => string = () => new Date().toISOString()) {}

  recordBuild(input: BuildRequest, result: BuildResult): DiagnosticInboxGroup[] {
    const targetKey = this.targetKey(input.relativePath, input.standard ?? 'c++17')
    if (result.process.cancelled) return this.list(input.projectId).groups
    if (result.success) {
      this.db.resolveDiagnosticIncidents(input.projectId, targetKey, ['compile', 'linker'], this.now())
      return this.publish(input.projectId).groups
    }
    const diagnostics = result.diagnostics.filter(item => item.severity === 'error' && (item.source === 'compiler' || item.source === 'linker'))
    const evidence = diagnostics.length ? diagnostics : [this.syntheticBuildDiagnostic(result)]
    this.save(input.projectId, input.runId, targetKey, 'build', evidence.map(diagnostic => ({
      kind: diagnostic.source === 'linker' ? 'linker' as const : 'compile' as const,
      diagnostic
    })))
    return this.publish(input.projectId).groups
  }

  recordRun(target: { projectId: string; relativePath: string; standard: CppStandard }, result: ProgramRunResult): DiagnosticInboxGroup[] {
    const targetKey = this.targetKey(target.relativePath, target.standard)
    if (result.process.cancelled) return this.list(target.projectId).groups
    if (result.success) {
      this.db.resolveDiagnosticIncidents(target.projectId, targetKey, ['runtime', 'nonzero-exit', 'timeout'], this.now())
      return this.publish(target.projectId).groups
    }
    const evidence = result.diagnostics.length
      ? result.diagnostics.filter(item => item.severity === 'error').map(diagnostic => ({ kind: this.runtimeKind(result, diagnostic), diagnostic }))
      : syntheticRuntimeDiagnostics(result.process)
    this.save(target.projectId, result.runId, targetKey, 'run', evidence)
    return this.publish(target.projectId).groups
  }

  list(projectId: string): DiagnosticInboxChangedEvent {
    const incidents = this.db.listActiveDiagnosticIncidents(projectId)
    return { projectId, groups: projectInboxProjection(incidents), attention: incidents.some(item => !item.acknowledgedAt) }
  }

  acknowledge(projectId: string): DiagnosticInboxChangedEvent {
    const incidents = this.db.listActiveDiagnosticIncidents(projectId)
    if (incidents.length) this.db.acknowledgeDiagnosticIncidents(projectId, incidents.map(item => item.id), this.now())
    return this.publish(projectId)
  }

  onChanged(listener: (event: DiagnosticInboxChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private save(
    projectId: string,
    attemptId: string,
    targetKey: string,
    operation: 'build' | 'run',
    evidence: Array<{ kind: DiagnosticFailureKind; diagnostic: Diagnostic }>
  ): void {
    if (!evidence.length) return
    const id = randomUUID()
    const now = this.now()
    const kinds = [...new Set(evidence.map(item => item.kind))]
    const groups = kinds.flatMap(kind => groupDiagnostics(id, kind, evidence.filter(item => item.kind === kind).map(item => item.diagnostic)))
    this.db.saveDiagnosticIncident({
      id, projectId, attemptId, targetKey, operation, failureKinds: kinds, status: 'active', createdAt: now, updatedAt: now, groups
    })
  }

  private publish(projectId: string): DiagnosticInboxChangedEvent {
    const event = this.list(projectId)
    for (const listener of this.listeners) listener(structuredClone(event))
    return event
  }

  private targetKey(relativePath: string, standard: CppStandard): string {
    return `${relativePath.replaceAll('\\', '/').toLowerCase()}:${standard}`
  }

  private runtimeKind(result: ProgramRunResult, diagnostic: Diagnostic): DiagnosticFailureKind {
    if (result.process.timedOut || diagnostic.code === 'RUN_TIMEOUT') return 'timeout'
    if ((result.process.exitCode ?? 0) < 0 || /segmentation fault|access violation|unhandled exception|崩溃|异常/i.test(diagnostic.rawMessage)) return 'runtime'
    return 'nonzero-exit'
  }

  private syntheticBuildDiagnostic(result: BuildResult): Diagnostic {
    const linker = /undefined reference|unresolved external|链接/i.test(`${result.process.stderr}\n${result.process.stdout}`)
    const message = linker ? '链接阶段失败。' : '编译阶段失败。'
    return {
      source: linker ? 'linker' : 'compiler', severity: 'error', code: linker ? 'LINK_FAILED' : 'BUILD_FAILED',
      file: result.relativePath, rawMessage: message, normalizedMessage: message, relatedConceptIds: []
    }
  }
}
