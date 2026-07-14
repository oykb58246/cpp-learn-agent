import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { basename, isAbsolute, relative } from 'node:path'
import type { DebugCommand, DebugFrame, DebugSessionState, DebugVariable, Diagnostic, LanguageDefinition } from '@cpp-pet/contracts'
import { ToolExecutionError } from './index'

interface PendingCommand {
  resolve(output: string): void
  reject(error: Error): void
  lines: string[]
  timer: ReturnType<typeof setTimeout>
}

const unescapeMi = (value: string): string => {
  try { return JSON.parse(`"${value}"`) as string } catch { return value.replaceAll('\\\\', '\\').replaceAll('\\n', '\n').replaceAll('\\"', '"') }
}

const capture = (value: string, pattern: RegExp) => value.match(pattern)?.[1]

export class GdbMiSession {
  readonly sessionId: string
  private child: ChildProcessWithoutNullStreams
  private token = 0
  private pending = new Map<number, PendingCommand>()
  private buffer = ''
  private state: DebugSessionState
  private waiters: Array<(state: DebugSessionState) => void> = []

  constructor(
    sessionId: string,
    readonly debuggerPath: string,
    readonly executablePath: string,
    readonly projectId: string,
    readonly projectRoot: string,
    readonly sourceMappings: ReadonlyMap<string, string> = new Map()
  ) {
    this.sessionId = sessionId
    this.state = { sessionId, projectId, status: 'starting', frames: [], variables: [], output: '', diagnostics: [] }
    this.child = spawn(debuggerPath, ['--interpreter=mi2', '--quiet', executablePath], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.on('data', chunk => this.consume(chunk.toString('utf8')))
    this.child.stderr.on('data', chunk => { this.state.output += chunk.toString('utf8') })
    this.child.on('exit', code => {
      this.state = { ...this.state, status: code === 0 ? 'exited' : 'error', reason: `调试器退出，退出码 ${code ?? '未知'}。` }
      this.resolveWaiters()
    })
  }

  async initialize(breakpoints: Array<{ path: string; line: number }>): Promise<DebugSessionState> {
    await this.command('-gdb-set pagination off')
    await this.command('-gdb-set print pretty on')
    await this.command('-gdb-set breakpoint pending on')
    for (const breakpoint of breakpoints) await this.command(`-break-insert "${breakpoint.path}:${breakpoint.line}"`)
    const stopped = this.waitForStop(20_000)
    await this.command('-exec-run')
    return stopped
  }

  async execute(command: DebugCommand): Promise<DebugSessionState> {
    if (command === 'stop') {
      await this.dispose()
      this.state = { ...this.state, status: 'exited', reason: '调试会话已停止。', location: undefined, frames: [], variables: [] }
      return this.snapshot()
    }
    const mapping: Record<Exclude<DebugCommand, 'stop'>, string> = {
      continue: '-exec-continue',
      next: '-exec-next',
      'step-in': '-exec-step',
      'step-out': '-exec-finish'
    }
    const stopped = this.waitForStop(20_000)
    await this.command(mapping[command])
    return stopped
  }

  snapshot(): DebugSessionState {
    return structuredClone(this.state)
  }

  async dispose(): Promise<void> {
    if (this.child.exitCode !== null) return
    try { await this.command('-gdb-exit', 2_000) } catch {}
    if (this.child.exitCode === null) {
      await Promise.race([
        new Promise<void>(resolve => this.child.once('close', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 1_000))
      ])
    }
    if (this.child.exitCode === null) this.child.kill()
  }

  private command(text: string, timeoutMs = 10_000): Promise<string> {
    const token = ++this.token
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(token)
        reject(new ToolExecutionError('DEBUG_COMMAND_TIMEOUT', `调试命令 ${text} 超时。`, '停止并重新启动调试会话。', true))
      }, timeoutMs)
      this.pending.set(token, { resolve, reject, lines: [], timer })
      try {
        this.child.stdin.write(`${token}${text}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(token)
        reject(error)
      }
    })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.handleLine(line)
  }

  private handleLine(line: string): void {
    const result = line.match(/^(\d+)\^(done|running|error|exit)(?:,(.*))?$/)
    if (result) {
      const token = Number(result[1])
      const pending = this.pending.get(token)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(token)
      if (result[2] === 'error') pending.reject(new ToolExecutionError('DEBUG_COMMAND_FAILED', capture(result[3] ?? '', /msg="((?:\\.|[^"])*)"/) ?? '调试命令失败。', '检查断点和程序状态后重试。', true))
      else pending.resolve([result[3] ?? '', ...pending.lines].filter(Boolean).join('\n'))
      return
    }
    if (line.startsWith('~"') || line.startsWith('@"') || line.startsWith('&"')) {
      const content = line.slice(2, -1)
      this.state.output += unescapeMi(content)
      for (const pending of this.pending.values()) pending.lines.push(line)
      return
    }
    if (line.startsWith('*running')) {
      this.state = { ...this.state, status: 'running', reason: undefined, frames: [], variables: [] }
      return
    }
    if (line.startsWith('*stopped')) void this.handleStopped(line)
  }

  private async handleStopped(line: string): Promise<void> {
    const reason = capture(line, /reason="([^"]+)"/) ?? 'stopped'
    if (reason === 'exited-normally' || reason.startsWith('exited')) {
      this.state = { ...this.state, status: 'exited', reason: '程序运行结束。', location: undefined, frames: [], variables: [] }
      this.resolveWaiters()
      return
    }
    const location = this.locationFrom(line)
    let frames: DebugFrame[] = []
    let variables: DebugVariable[] = []
    try {
      frames = this.parseFrames(await this.command('-stack-list-frames'))
      variables = this.parseVariables(await this.command('-stack-list-variables --simple-values'))
    } catch {}
    this.state = { ...this.state, status: 'stopped', reason, ...(location ? { location } : {}), frames, variables }
    this.resolveWaiters()
  }

  private locationFrom(line: string): LanguageDefinition | undefined {
    const file = capture(line, /(?:fullname|file)="((?:\\.|[^"])*)"/)
    const lineNumber = Number(capture(line, /line="(\d+)"/) ?? 0)
    if (!file || !lineNumber) return undefined
    const clean = unescapeMi(file)
    const rel = this.relativePathFor(clean)
    return { relativePath: rel.replaceAll('\\', '/'), line: lineNumber, column: 1 }
  }

  private parseFrames(output: string): DebugFrame[] {
    return [...output.matchAll(/frame=\{([^}]*)}/g)].map(match => {
      const content = match[1] ?? ''
      const file = capture(content, /(?:fullname|file)="((?:\\.|[^"])*)"/)
      const clean = file ? unescapeMi(file) : undefined
      const line = Number(capture(content, /line="(\d+)"/) ?? 0)
      return {
        level: Number(capture(content, /level="(\d+)"/) ?? 0),
        functionName: capture(content, /func="((?:\\.|[^"])*)"/) ?? '<unknown>',
        ...(clean ? { relativePath: this.relativePathFor(clean).replaceAll('\\', '/') } : {}),
        ...(line ? { line } : {})
      }
    })
  }

  private parseVariables(output: string): DebugVariable[] {
    return [...output.matchAll(/\{name="((?:\\.|[^"])*)"(?:,type="((?:\\.|[^"])*)")?(?:,value="((?:\\.|[^"])*)")?}/g)].map(match => ({
      name: unescapeMi(match[1] ?? ''),
      value: unescapeMi(match[3] ?? '<不可用>'),
      ...(match[2] ? { type: unescapeMi(match[2]) } : {})
    }))
  }

  private waitForStop(timeoutMs: number): Promise<DebugSessionState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(done)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new ToolExecutionError('DEBUG_STOP_TIMEOUT', '调试器未在预期时间内暂停。', '停止调试，检查程序是否在等待输入。', true))
      }, timeoutMs)
      const done = (state: DebugSessionState) => {
        clearTimeout(timer)
        resolve(state)
      }
      this.waiters.push(done)
    })
  }

  private resolveWaiters(): void {
    const state = this.snapshot()
    for (const waiter of this.waiters.splice(0)) waiter(state)
  }

  private relativePathFor(path: string): string {
    const normalized = path.replaceAll('\\', '/').toLowerCase()
    for (const [sourcePath, relativePath] of this.sourceMappings) {
      if (sourcePath.replaceAll('\\', '/').toLowerCase() === normalized) return relativePath
    }
    return isAbsolute(path) ? relative(this.projectRoot, path) : basename(path)
  }
}

export function debugDiagnostics(message: string): Diagnostic[] {
  return [{ source: 'debugger', severity: 'error', rawMessage: message, normalizedMessage: message, relatedConceptIds: ['debugging.session'] }]
}
