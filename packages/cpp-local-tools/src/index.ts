import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  CppStandard,
  Diagnostic,
  DevelopmentTool,
  ProcessResult,
  ToolchainCandidate,
  ToolchainDetectionResult,
  ToolchainHealthResult,
  ToolchainProbeResult,
  ToolchainProfile
} from '@cpp-pet/contracts'

export class ToolExecutionError extends Error {
  constructor(readonly code: string, message: string, readonly userAction: string, readonly retryable = false) {
    super(message)
  }
}

export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export interface SingleFileBuildOptions {
  profile: ToolchainProfile
  projectRoot: string
  sourcePath: string
  sourceRelativePath: string
  outputDirectory: string
  standard?: CppStandard
  signal?: AbortSignal
}

export interface SingleFileBuildResult {
  artifactPath: string
  process: ProcessResult
  diagnostics: Diagnostic[]
  success: boolean
}

export function runProcess(command: string, args: string[] = [], options: ProcessOptions = {}): Promise<ProcessResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let outputTruncated = false
    let timedOut = false
    let cancelled = false
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        command,
        args,
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Process could not be started.',
        durationMs: Date.now() - startedAt,
        timedOut: false,
        cancelled: false,
        outputTruncated: false
      })
      return
    }
    child.stdin?.end(options.input ?? '')

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes)
      if (remaining === 0) {
        outputTruncated = true
        return
      }
      const value = chunk.subarray(0, remaining).toString('utf8')
      outputBytes += Buffer.byteLength(value)
      if (chunk.byteLength > remaining) outputTruncated = true
      if (target === 'stdout') stdout += value
      else stderr += value
    }
    child.stdout?.on('data', chunk => append('stdout', chunk as Buffer))
    child.stderr?.on('data', chunk => append('stderr', chunk as Buffer))

    const stop = () => {
      if (child.killed) return
      child.kill()
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        killer.unref()
      }
    }
    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        cancelled,
        outputTruncated
      })
    }
    const onAbort = () => {
      cancelled = true
      stop()
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    child.on('error', error => {
      stderr += stderr ? `\n${error.message}` : error.message
      finish(null)
    })
    child.on('close', code => finish(code))
  })
}

const commonExecutables = {
  'g++.exe': [
    'C:\\msys64\\ucrt64\\bin\\g++.exe',
    'C:\\msys64\\mingw64\\bin\\g++.exe',
    'C:\\mingw64\\bin\\g++.exe',
    'C:\\MinGW\\bin\\g++.exe'
  ],
  'clang++.exe': ['C:\\Program Files\\LLVM\\bin\\clang++.exe'],
  'clangd.exe': ['C:\\Program Files\\LLVM\\bin\\clangd.exe'],
  'clang-tidy.exe': ['C:\\Program Files\\LLVM\\bin\\clang-tidy.exe'],
  'code.cmd': [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd'
  ],
  'cmake.exe': ['C:\\Program Files\\CMake\\bin\\cmake.exe'],
  'ctest.exe': ['C:\\Program Files\\CMake\\bin\\ctest.exe']
} as const

const toolNames: Array<{ kind: DevelopmentTool['kind']; names: string[] }> = [
  { kind: 'vscode', names: ['code.cmd', 'code.exe'] },
  { kind: 'cmake', names: ['cmake.exe'] },
  { kind: 'ctest', names: ['ctest.exe'] },
  { kind: 'ninja', names: ['ninja.exe'] },
  { kind: 'make', names: ['mingw32-make.exe', 'make.exe'] },
  { kind: 'gdb', names: ['gdb.exe'] },
  { kind: 'lldb', names: ['lldb.exe'] },
  { kind: 'clangd', names: ['clangd.exe'] },
  { kind: 'clang-tidy', names: ['clang-tidy.exe'] }
]

const cleanPathEntry = (value: string) => value.trim().replace(/^"(.*)"$/, '$1')
const pathEntries = (env: NodeJS.ProcessEnv) => (env.Path ?? env.PATH ?? '').split(';').map(cleanPathEntry).filter(Boolean)
const pathKey = (value: string) => normalize(value).replaceAll('\\', '/').toLowerCase()
const firstLine = (value: string) => value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? ''
const candidateId = (family: string, compilerPath: string) => `${family}:${createHash('sha256').update(pathKey(compilerPath)).digest('hex').slice(0, 16)}`
const cmdQuote = (value: string) => `"${value.replaceAll('"', '""')}"`

function conceptIds(message: string, source: Diagnostic['source']): string[] {
  const ids = new Set<string>()
  if (/expected ['"]?;|missing ['"]?;/i.test(message)) ids.add('syntax.semicolon')
  if (/not declared|undeclared identifier|unknown identifier/i.test(message)) ids.add('variables.scope')
  if (/no matching function|cannot convert|invalid conversion|incompatible/i.test(message)) ids.add('types.conversion')
  if (/undefined reference|unresolved external symbol|multiple definition/i.test(message)) ids.add('build.linker')
  if (/no such file|cannot open include file|file not found/i.test(message)) ids.add('build.headers')
  if (source === 'runtime') ids.add('runtime.process')
  return [...ids]
}

function normalizedFile(value: string | undefined, projectRoot: string): string | undefined {
  if (!value) return undefined
  const clean = value.trim().replace(/^"|"$/g, '')
  if (!isAbsolute(clean)) return clean.replaceAll('\\', '/')
  const rel = relative(projectRoot, clean)
  return rel.startsWith('..') || isAbsolute(rel) ? basename(clean) : rel.replaceAll('\\', '/')
}

export function parseCompilerDiagnostics(output: string, family: ToolchainProfile['family'], projectRoot: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()
  const push = (item: Omit<Diagnostic, 'relatedConceptIds'>) => {
    const key = `${item.source}:${item.file ?? ''}:${item.line ?? ''}:${item.column ?? ''}:${item.rawMessage}`
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push({ ...item, relatedConceptIds: conceptIds(item.rawMessage, item.source) })
  }

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const msvc = family === 'msvc'
      ? line.match(/^(.+?)\((\d+)(?:,(\d+))?\):\s*(fatal error|error|warning)\s*([A-Z]+\d+)?\s*:?\s*(.+)$/i)
      : null
    if (msvc) {
      const message = msvc[6] ?? line
      push({
        source: /LNK\d+/i.test(msvc[5] ?? '') ? 'linker' : 'compiler',
        severity: /warning/i.test(msvc[4] ?? '') ? 'warning' : 'error',
        ...(msvc[5] ? { code: msvc[5] } : {}),
        ...(msvc[1] ? { file: normalizedFile(msvc[1], projectRoot) } : {}),
        ...(msvc[2] ? { line: Number(msvc[2]) } : {}),
        ...(msvc[3] ? { column: Number(msvc[3]) } : {}),
        rawMessage: message,
        normalizedMessage: message
      })
      continue
    }

    const gcc = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/i)
    if (gcc) {
      const kind = gcc[4] ?? 'error'
      const message = gcc[5] ?? line
      push({
        source: 'compiler',
        severity: /warning/i.test(kind) ? 'warning' : /note/i.test(kind) ? 'info' : 'error',
        ...(gcc[1] ? { file: normalizedFile(gcc[1], projectRoot) } : {}),
        ...(gcc[2] ? { line: Number(gcc[2]) } : {}),
        ...(gcc[3] ? { column: Number(gcc[3]) } : {}),
        rawMessage: message,
        normalizedMessage: message
      })
      continue
    }

    if (/undefined reference|unresolved external symbol|multiple definition|collect2: error|link : fatal error|ld\.exe:/i.test(line)) {
      push({ source: 'linker', severity: 'error', rawMessage: line, normalizedMessage: line })
    }
  }
  return diagnostics
}

export function runtimeDiagnostics(result: ProcessResult): Diagnostic[] {
  if (result.cancelled) {
    return [{ source: 'runtime', severity: 'info', rawMessage: '程序运行已取消。', normalizedMessage: '程序运行已取消。', relatedConceptIds: ['runtime.process'] }]
  }
  if (result.timedOut) {
    return [{ source: 'runtime', severity: 'error', code: 'RUN_TIMEOUT', rawMessage: '程序运行超时，已终止进程。', normalizedMessage: '程序可能存在死循环，或正在等待更多输入。', relatedConceptIds: ['runtime.process', 'control-flow.loop'] }]
  }
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || `程序异常退出，退出码为 ${result.exitCode ?? '未知'}。`
    return [{ source: 'runtime', severity: 'error', code: 'RUN_NON_ZERO_EXIT', rawMessage: message, normalizedMessage: message, relatedConceptIds: ['runtime.process'] }]
  }
  return []
}

export function parseCompilerVersion(output: string, fallback = 'unknown'): string {
  const patterns = [
    /clang version\s+([0-9]+(?:\.[0-9]+){1,3})/i,
    /(?:g\+\+|gcc).*?([0-9]+(?:\.[0-9]+){1,3})/i,
    /version\s+([0-9]+(?:\.[0-9]+){1,3})/i
  ]
  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match?.[1]) return match[1]
  }
  const line = firstLine(output)
  return line && !line.includes('\uFFFD') ? line : fallback
}

function findExecutables(names: string[], env = process.env, extra: string[] = []): string[] {
  const found = new Map<string, string>()
  for (const directory of pathEntries(env)) {
    for (const name of names) {
      const value = join(directory, name)
      if (existsSync(value)) found.set(pathKey(value), value)
    }
  }
  for (const value of extra) if (value && existsSync(value)) found.set(pathKey(value), value)
  return [...found.values()]
}

function siblingExecutable(compilerPath: string, names: string[]): string | undefined {
  return names.map(name => join(dirname(compilerPath), name)).find(existsSync)
}

function targetArch(output: string): string {
  const target = output.match(/Target:\s*([^\s]+)/i)?.[1]
  if (target) return target
  if (/x86_64|amd64|\bx64\b/i.test(output)) return 'x64'
  if (/aarch64|arm64/i.test(output)) return 'arm64'
  if (/\bi[3-6]86\b|\bx86\b/i.test(output)) return 'x86'
  return process.arch
}

async function executableVersion(path: string): Promise<ProcessResult> {
  if (extname(path).toLowerCase() === '.cmd') {
    return runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', path, '--version'], { timeoutMs: 4_000, maxOutputBytes: 32 * 1024 })
  }
  return runProcess(path, ['--version'], { timeoutMs: 4_000, maxOutputBytes: 32 * 1024 })
}

async function msvcVersion(compilerPath: string, environmentScript: string): Promise<ProcessResult> {
  const command = `call ${cmdQuote(environmentScript)} -no_logo -arch=x64 -host_arch=x64 && ${cmdQuote(compilerPath)} /nologo /Bv`
  return runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 })
}

async function visualStudioCandidates(): Promise<Array<{ compilerPath: string; environmentScript: string }>> {
  const vswhere = [
    join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    join(process.env.ProgramFiles ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  ].find(existsSync)
  if (!vswhere) return []
  const result = await runProcess(vswhere, ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { timeoutMs: 5_000 })
  if (result.exitCode !== 0) return []
  const output: Array<{ compilerPath: string; environmentScript: string }> = []
  for (const installPath of result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const environmentScript = join(installPath, 'Common7', 'Tools', 'VsDevCmd.bat')
    const toolsRoot = join(installPath, 'VC', 'Tools', 'MSVC')
    if (!existsSync(environmentScript) || !existsSync(toolsRoot)) continue
    const versions = readdirSync(toolsRoot, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort().reverse()
    for (const version of versions) {
      const compilerPath = join(toolsRoot, version, 'bin', 'Hostx64', 'x64', 'cl.exe')
      if (existsSync(compilerPath)) {
        output.push({ compilerPath, environmentScript })
        break
      }
    }
  }
  return output
}

export class ToolchainService {
  private candidates = new Map<string, ToolchainCandidate>()

  async detect(): Promise<ToolchainDetectionResult> {
    const tools = await this.detectTools()
    const toolPath = (kind: DevelopmentTool['kind']) => tools.find(tool => tool.kind === kind)?.path
    const candidates: ToolchainCandidate[] = []

    const gccPaths = findExecutables(['g++.exe'], process.env, [...commonExecutables['g++.exe']])
    for (const compilerPath of gccPaths) {
      const result = await executableVersion(compilerPath)
      const output = `${result.stdout}\n${result.stderr}`
      const debuggerPath = siblingExecutable(compilerPath, ['gdb.exe']) ?? toolPath('gdb')
      candidates.push({
        id: candidateId('gcc', compilerPath),
        family: 'gcc',
        compilerPath,
        version: parseCompilerVersion(output),
        targetArch: targetArch(output),
        source: pathEntries(process.env).some(entry => pathKey(compilerPath).startsWith(`${pathKey(entry)}/`)) ? 'path' : 'common-location',
        ...(debuggerPath ? { debuggerPath } : {}),
        ...(toolPath('clangd') ? { languageServerPath: toolPath('clangd') } : {}),
        ...(toolPath('cmake') ? { cmakeGenerator: toolPath('ninja') ? 'Ninja' : 'MinGW Makefiles' } : {}),
        capabilities: { compile: true, debug: Boolean(debuggerPath), compileDatabase: true }
      })
    }

    const clangPaths = findExecutables(['clang++.exe'], process.env, [...commonExecutables['clang++.exe']])
    for (const compilerPath of clangPaths) {
      const result = await executableVersion(compilerPath)
      const output = `${result.stdout}\n${result.stderr}`
      const debuggerPath = siblingExecutable(compilerPath, ['lldb.exe']) ?? toolPath('lldb')
      const languageServerPath = siblingExecutable(compilerPath, ['clangd.exe']) ?? toolPath('clangd')
      candidates.push({
        id: candidateId('clang', compilerPath),
        family: 'clang',
        compilerPath,
        version: parseCompilerVersion(output),
        targetArch: targetArch(output),
        source: pathEntries(process.env).some(entry => pathKey(compilerPath).startsWith(`${pathKey(entry)}/`)) ? 'path' : 'common-location',
        ...(debuggerPath ? { debuggerPath } : {}),
        ...(languageServerPath ? { languageServerPath } : {}),
        ...(toolPath('cmake') ? { cmakeGenerator: toolPath('ninja') ? 'Ninja' : 'NMake Makefiles' } : {}),
        capabilities: { compile: true, debug: Boolean(debuggerPath), compileDatabase: true }
      })
    }

    for (const item of await visualStudioCandidates()) {
      const result = await msvcVersion(item.compilerPath, item.environmentScript)
      const output = `${result.stdout}\n${result.stderr}`
      candidates.push({
        id: candidateId('msvc', item.compilerPath),
        family: 'msvc',
        compilerPath: item.compilerPath,
        version: parseCompilerVersion(output),
        targetArch: 'x64',
        source: 'visual-studio',
        environmentScript: item.environmentScript,
        ...(toolPath('cmake') ? { cmakeGenerator: toolPath('ninja') ? 'Ninja' : 'Visual Studio 17 2022' } : {}),
        capabilities: { compile: true, debug: true, compileDatabase: Boolean(toolPath('cmake')) }
      })
    }

    this.candidates = new Map(candidates.map(candidate => [candidate.id, candidate]))
    return { candidates, tools, detectedAt: new Date().toISOString() }
  }

  async probe(candidateIdValue: string): Promise<ToolchainProbeResult> {
    const candidate = this.candidates.get(candidateIdValue)
    if (!candidate) throw new ToolExecutionError('TOOLCHAIN_CANDIDATE_EXPIRED', '工具链候选项已失效。', '请重新检测本机工具链。', true)

    const directory = mkdtempSync(join(tmpdir(), 'cpppet-toolchain-'))
    const sourcePath = join(directory, 'smoke.cpp')
    const executablePath = join(directory, 'smoke.exe')
    writeFileSync(sourcePath, '#include <iostream>\nint main() { std::cout << "CPP_PET_OK"; return 0; }\n', 'utf8')
    try {
      const compile = candidate.family === 'msvc'
        ? await this.compileWithMsvc(candidate, sourcePath, executablePath, directory)
        : await runProcess(candidate.compilerPath, [sourcePath, '-std=c++17', '-Wall', '-Wextra', '-o', executablePath], { cwd: directory, timeoutMs: 20_000, maxOutputBytes: 256 * 1024 })
      if (compile.exitCode !== 0 || compile.timedOut || !existsSync(executablePath)) {
        return { candidate, success: false, compile, failureReason: compile.timedOut ? '烟雾编译超时。' : '编译器未能生成可执行文件。' }
      }
      const run = await runProcess(executablePath, [], { cwd: directory, timeoutMs: 4_000, maxOutputBytes: 64 * 1024 })
      const success = run.exitCode === 0 && !run.timedOut && run.stdout.trim() === 'CPP_PET_OK'
      const profile = success ? this.profileFromCandidate(candidate) : undefined
      return {
        candidate,
        success,
        compile,
        run,
        ...(profile ? { profile } : {}),
        ...(!success ? { failureReason: run.timedOut ? '烟雾程序运行超时。' : '烟雾程序输出或退出码不符合预期。' } : {})
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  async bind(candidateIdValue: string): Promise<ToolchainProfile> {
    const result = await this.probe(candidateIdValue)
    if (!result.success || !result.profile) throw new ToolExecutionError('TOOLCHAIN_PROBE_FAILED', result.failureReason ?? '工具链验证失败。', '查看编译输出，修复环境后重新检测。', true)
    return result.profile
  }

  async health(profile: ToolchainProfile): Promise<ToolchainHealthResult> {
    const checkedAt = new Date().toISOString()
    if (!existsSync(profile.compilerPath)) return { profileId: profile.id, healthy: false, checkedAt, reason: '编译器路径已不存在。' }
    const versionResult = profile.family === 'msvc' && profile.environmentScript
      ? await msvcVersion(profile.compilerPath, profile.environmentScript)
      : await executableVersion(profile.compilerPath)
    const healthy = !versionResult.timedOut && parseCompilerVersion(`${versionResult.stdout}\n${versionResult.stderr}`) !== 'unknown'
    return { profileId: profile.id, healthy, checkedAt, versionResult, ...(!healthy ? { reason: '编译器版本检查失败。' } : {}) }
  }

  async buildSingleFile(options: SingleFileBuildOptions): Promise<SingleFileBuildResult> {
    const standard = options.standard ?? 'c++17'
    mkdirSync(options.outputDirectory, { recursive: true })
    const artifactName = `${basename(options.sourceRelativePath, extname(options.sourceRelativePath)) || 'program'}.exe`
    const artifactPath = join(options.outputDirectory, artifactName)
    rmSync(artifactPath, { force: true })
    const process = options.profile.family === 'msvc'
      ? await this.compileProfileWithMsvc(options.profile, options.sourcePath, artifactPath, options.projectRoot, standard, options.signal)
      : await runProcess(options.profile.compilerPath, [
        options.sourcePath,
        `-std=${standard}`,
        '-Wall',
        '-Wextra',
        '-pedantic',
        '-o',
        artifactPath
      ], {
        cwd: options.projectRoot,
        timeoutMs: 30_000,
        maxOutputBytes: 512 * 1024,
        ...(options.signal ? { signal: options.signal } : {})
      })
    return {
      artifactPath,
      process,
      diagnostics: parseCompilerDiagnostics(`${process.stderr}\n${process.stdout}`, options.profile.family, options.projectRoot),
      success: process.exitCode === 0 && !process.timedOut && !process.cancelled && existsSync(artifactPath)
    }
  }

  private profileFromCandidate(candidate: ToolchainCandidate): ToolchainProfile {
    return {
      id: randomUUID(),
      family: candidate.family,
      version: candidate.version,
      targetArch: candidate.targetArch,
      compilerPath: candidate.compilerPath,
      ...(candidate.debuggerPath ? { debuggerPath: candidate.debuggerPath } : {}),
      ...(candidate.environmentScript ? { environmentScript: candidate.environmentScript } : {}),
      ...(candidate.languageServerPath ? { languageServerPath: candidate.languageServerPath } : {}),
      ...(candidate.cmakeGenerator ? { cmakeGenerator: candidate.cmakeGenerator } : {}),
      capabilities: candidate.capabilities,
      verifiedAt: new Date().toISOString()
    }
  }

  private async compileWithMsvc(candidate: ToolchainCandidate, sourcePath: string, executablePath: string, cwd: string): Promise<ProcessResult> {
    if (!candidate.environmentScript) throw new ToolExecutionError('TOOLCHAIN_MSVC_ENV_MISSING', 'MSVC 环境初始化脚本不存在。', '通过 Visual Studio Installer 安装 C++ 生成工具。')
    return this.compileProfileWithMsvc({
      id: randomUUID(),
      family: 'msvc',
      version: candidate.version,
      targetArch: candidate.targetArch,
      compilerPath: candidate.compilerPath,
      environmentScript: candidate.environmentScript,
      capabilities: candidate.capabilities,
      verifiedAt: new Date().toISOString()
    }, sourcePath, executablePath, cwd, 'c++17')
  }

  private async compileProfileWithMsvc(profile: ToolchainProfile, sourcePath: string, executablePath: string, cwd: string, standard: CppStandard, signal?: AbortSignal): Promise<ProcessResult> {
    if (!profile.environmentScript) throw new ToolExecutionError('TOOLCHAIN_MSVC_ENV_MISSING', 'MSVC 环境初始化脚本不存在。', '通过 Visual Studio Installer 安装 C++ 生成工具。')
    const msvcStandard = standard === 'c++23' ? 'c++latest' : standard
    const command = [
      `call ${cmdQuote(profile.environmentScript)} -no_logo -arch=x64 -host_arch=x64`,
      `${cmdQuote(profile.compilerPath)} /nologo /EHsc /std:${msvcStandard} ${cmdQuote(sourcePath)} /Fe:${cmdQuote(executablePath)}`
    ].join(' && ')
    return runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 512 * 1024,
      ...(signal ? { signal } : {})
    })
  }

  private async detectTools(): Promise<DevelopmentTool[]> {
    const tools: DevelopmentTool[] = []
    for (const item of toolNames) {
      const extras = item.names.flatMap(name => commonExecutables[name as keyof typeof commonExecutables] ?? [])
      const path = findExecutables(item.names, process.env, extras)[0]
      if (!path) continue
      const result = await executableVersion(path)
      const output = `${result.stdout}\n${result.stderr}`
      tools.push({ kind: item.kind, path, ...(firstLine(output) ? { version: firstLine(output) } : {}) })
    }
    return tools
  }
}

export const displayExecutable = (value: string) => basename(value)
