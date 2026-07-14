import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { isAbsolute, relative } from 'node:path'
import type { Diagnostic, LanguageCompletion, LanguageDefinition, LanguageHover } from '@cpp-pet/contracts'
import { ToolExecutionError } from './index'

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface LspPosition {
  line: number
  character: number
}

const markdownText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(markdownText).filter(Boolean).join('\n\n')
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  if (typeof item.language === 'string' && typeof item.value === 'string') return `\`\`\`${item.language}\n${item.value}\n\`\`\``
  if (typeof item.value === 'string') return item.value
  return ''
}

const lspSeverity = (value: unknown): Diagnostic['severity'] => value === 1 ? 'error' : value === 2 ? 'warning' : 'info'

export class ClangdSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private initialized = false
  private documents = new Set<string>()

  constructor(
    readonly serverPath: string,
    readonly projectId: string,
    readonly projectRoot: string,
    readonly compileCommandsDirectory: string | undefined,
    readonly onDiagnostics: (relativePath: string, diagnostics: Diagnostic[]) => void,
    readonly serverArgs?: string[]
  ) {}

  async start(): Promise<void> {
    if (this.child) return
    const args = this.serverArgs
      ? [...this.serverArgs]
      : ['--background-index', '--clang-tidy=false', '--log=error']
    if (!this.serverArgs && this.compileCommandsDirectory) args.push(`--compile-commands-dir=${this.compileCommandsDirectory}`)
    this.child = spawn(this.serverPath, args, { cwd: this.projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', chunk => this.consume(chunk as Buffer))
    this.child.stderr.on('data', () => {})
    this.child.on('exit', () => {
      const error = new ToolExecutionError('LANGUAGE_SERVER_EXITED', 'clangd 语言服务已退出。', '重新打开项目或检查 clangd 安装。', true)
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(error)
      }
      this.pending.clear()
      this.child = null
      this.initialized = false
      this.documents.clear()
    })
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(this.projectRoot).href,
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: {}
        }
      },
      workspaceFolders: [{ uri: pathToFileURL(this.projectRoot).href, name: this.projectId }]
    })
    if (!result) throw new ToolExecutionError('LANGUAGE_SERVER_INIT_FAILED', 'clangd 初始化失败。', '检查 clangd 版本与项目配置。', true)
    this.notify('initialized', {})
    this.initialized = true
  }

  async sync(relativePath: string, absolutePath: string, content: string, version: number): Promise<void> {
    await this.start()
    const uri = pathToFileURL(absolutePath).href
    if (!this.documents.has(uri)) {
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version, text: content } })
      this.documents.add(uri)
    } else {
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: content }] })
    }
    void relativePath
  }

  async completion(absolutePath: string, position: LspPosition): Promise<LanguageCompletion[]> {
    await this.start()
    const raw = await this.request('textDocument/completion', { textDocument: { uri: pathToFileURL(absolutePath).href }, position })
    const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items) ? (raw as { items: unknown[] }).items : []
    return items.slice(0, 200).flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      if (typeof value.label !== 'string') return []
      const textEdit = value.textEdit && typeof value.textEdit === 'object' ? value.textEdit as Record<string, unknown> : undefined
      return [{
        label: value.label,
        ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
        ...(markdownText(value.documentation) ? { documentation: markdownText(value.documentation) } : {}),
        ...(typeof value.insertText === 'string' ? { insertText: value.insertText } : typeof textEdit?.newText === 'string' ? { insertText: textEdit.newText } : {}),
        ...(typeof value.kind === 'number' ? { kind: value.kind } : {})
      }]
    })
  }

  async hover(absolutePath: string, position: LspPosition): Promise<LanguageHover | null> {
    await this.start()
    const raw = await this.request('textDocument/hover', { textDocument: { uri: pathToFileURL(absolutePath).href }, position })
    if (!raw || typeof raw !== 'object') return null
    const contents = markdownText((raw as Record<string, unknown>).contents)
    return contents ? { contents } : null
  }

  async definition(absolutePath: string, position: LspPosition): Promise<LanguageDefinition | null> {
    await this.start()
    const raw = await this.request('textDocument/definition', { textDocument: { uri: pathToFileURL(absolutePath).href }, position })
    const first = Array.isArray(raw) ? raw[0] : raw
    if (!first || typeof first !== 'object') return null
    const item = first as Record<string, unknown>
    const uri = typeof item.uri === 'string' ? item.uri : typeof item.targetUri === 'string' ? item.targetUri : undefined
    const range = (item.range ?? item.targetSelectionRange) as Record<string, unknown> | undefined
    const start = range?.start as Record<string, unknown> | undefined
    if (!uri || !start || typeof start.line !== 'number' || typeof start.character !== 'number') return null
    const path = fileURLToPath(uri)
    const rel = isAbsolute(path) ? relative(this.projectRoot, path) : path
    return { relativePath: rel.replaceAll('\\', '/'), line: start.line + 1, column: start.character + 1 }
  }

  async dispose(): Promise<void> {
    if (!this.child) return
    const child = this.child
    try {
      if (this.initialized) {
        await this.request('shutdown', null, 2_000)
        this.notify('exit', null)
      }
    } catch {}
    if (child.exitCode === null) {
      await Promise.race([
        new Promise<void>(resolve => child.once('close', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 1_000))
      ])
    }
    if (child.exitCode === null) child.kill()
    this.child = null
  }

  private request(method: string, params: unknown, timeoutMs = 10_000): Promise<unknown> {
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ToolExecutionError('LANGUAGE_SERVER_TIMEOUT', `clangd 请求 ${method} 超时。`, '稍后重试或重新打开项目。', true))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(payload: unknown): void {
    if (!this.child) throw new ToolExecutionError('LANGUAGE_SERVER_NOT_READY', 'clangd 尚未启动。', '重新打开项目。', true)
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    this.child.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0)
      const bodyStart = headerEnd + 4
      if (!length || this.buffer.byteLength < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try { this.handleMessage(JSON.parse(body) as Record<string, unknown>) } catch {}
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.method !== 'textDocument/publishDiagnostics' || !message.params || typeof message.params !== 'object') return
    const params = message.params as Record<string, unknown>
    if (typeof params.uri !== 'string' || !Array.isArray(params.diagnostics)) return
    const absolutePath = fileURLToPath(params.uri)
    const relativePath = relative(this.projectRoot, absolutePath).replaceAll('\\', '/')
    const diagnostics = params.diagnostics.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      const range = value.range as Record<string, unknown> | undefined
      const start = range?.start as Record<string, unknown> | undefined
      const message = typeof value.message === 'string' ? value.message : 'clangd diagnostic'
      return [{
        source: 'clangd' as const,
        severity: lspSeverity(value.severity),
        ...(typeof value.code === 'string' || typeof value.code === 'number' ? { code: String(value.code) } : {}),
        file: relativePath,
        ...(typeof start?.line === 'number' ? { line: start.line + 1 } : {}),
        ...(typeof start?.character === 'number' ? { column: start.character + 1 } : {}),
        rawMessage: message,
        normalizedMessage: message,
        relatedConceptIds: []
      }]
    })
    this.onDiagnostics(relativePath, diagnostics)
  }
}
