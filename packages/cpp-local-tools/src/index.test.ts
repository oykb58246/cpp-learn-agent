import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mergeWindowsPathEnvironment, parseClangTidyDiagnostics, parseCompilerDiagnostics, parseCompilerVersion, parseCtestSummary, runProcess, runtimeDiagnostics, ToolchainService, vscodeOpenArgs } from './index'

describe('cpp-local-tools', () => {
  it('merges live Windows PATH values into a stale process environment', () => {
    const environment = mergeWindowsPathEnvironment(
      { Path: 'C:\\app-bin;C:\\Windows\\System32', PATHEXT: '.EXE' },
      'C:\\Windows\\System32;C:\\Program Files\\CMake\\bin',
      'C:\\Users\\learner\\AppData\\Local\\Programs\\LLVM\\bin'
    )

    expect(environment.Path).toBe([
      'C:\\app-bin',
      'C:\\Windows\\System32',
      'C:\\Program Files\\CMake\\bin',
      'C:\\Users\\learner\\AppData\\Local\\Programs\\LLVM\\bin'
    ].join(';'))
    expect(environment.PATHEXT).toBe('.EXE')
  })

  it('normalizes compiler versions', () => {
    expect(parseCompilerVersion('g++ (Rev2, Built by MSYS2 project) 14.2.0')).toBe('14.2.0')
    expect(parseCompilerVersion('g++.exe (MinGW.org GCC-6.3.0-1) 6.3.0')).toBe('6.3.0')
    expect(parseCompilerVersion('clang version 19.1.7')).toBe('19.1.7')
    expect(parseCompilerVersion('Microsoft (R) C/C++ Optimizing Compiler Version 19.43.34808 for x64')).toBe('19.43.34808')
  })

  it('limits untrusted process output', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { maxOutputBytes: 128 })
    expect(result.exitCode).toBe(0)
    expect(result.outputTruncated).toBe(true)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(128)
  })

  it('passes bounded standard input to child processes', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: '42\n' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('42\n')
  })

  it('stops timed out processes', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(5_000)
  })

  it('normalizes GCC and MSVC diagnostics', () => {
    const gcc = parseCompilerDiagnostics('C:\\work\\main.cpp:7:12: error: expected ; before } token', 'gcc', 'C:\\work')
    expect(gcc[0]).toMatchObject({ source: 'compiler', severity: 'error', file: 'main.cpp', line: 7, column: 12 })
    expect(gcc[0]?.relatedConceptIds).toContain('syntax.semicolon')

    const msvc = parseCompilerDiagnostics('C:\\work\\main.cpp(9,5): error C2065: value: undeclared identifier', 'msvc', 'C:\\work')
    expect(msvc[0]).toMatchObject({ source: 'compiler', severity: 'error', code: 'C2065', file: 'main.cpp', line: 9, column: 5 })
    expect(msvc[0]?.relatedConceptIds).toContain('variables.scope')
  })

  it('turns timeout and abnormal exit into runtime diagnostics', () => {
    const base = { command: 'program.exe', args: [], stdout: '', stderr: '', durationMs: 100, cancelled: false, outputTruncated: false }
    expect(runtimeDiagnostics({ ...base, exitCode: null, timedOut: true })[0]?.code).toBe('RUN_TIMEOUT')
    expect(runtimeDiagnostics({ ...base, exitCode: -1, timedOut: false })[0]?.code).toBe('RUN_NON_ZERO_EXIT')
  })

  it('normalizes clang-tidy diagnostics', () => {
    const diagnostics = parseClangTidyDiagnostics('C:\\work\\main.cpp:5:9: warning: use a range-based for loop [modernize-loop-convert]', 'C:\\work')
    expect(diagnostics[0]).toMatchObject({
      source: 'clang-tidy',
      severity: 'warning',
      code: 'modernize-loop-convert',
      file: 'main.cpp',
      line: 5,
      column: 9
    })
  })

  it('parses CTest summaries', () => {
    expect(parseCtestSummary('100% tests passed, 0 tests failed out of 3')).toEqual({ total: 3, passed: 3, failed: 0 })
    expect(parseCtestSummary('50% tests passed, 1 tests failed out of 2')).toEqual({ total: 2, passed: 1, failed: 1 })
    expect(parseCtestSummary('100% tests passed out of 1')).toEqual({ total: 1, passed: 1, failed: 0 })
  })

  it('opens VS Code in a new window and keeps file positioning', () => {
    expect(vscodeOpenArgs('C:\\work')).toEqual(['-n', 'C:\\work'])
    expect(vscodeOpenArgs('C:\\work', { path: 'C:\\work\\main.cpp', line: 8, column: 4 })).toEqual([
      '-n',
      'C:\\work',
      '-g',
      'C:\\work\\main.cpp:8:4'
    ])
  })

  it('builds the fixed CMake fixture and runs CTest with real local tools', async () => {
    const service = new ToolchainService()
    const detection = await service.detect()
    const candidate = detection.candidates.find(item => item.family === 'gcc' || item.family === 'clang') ?? detection.candidates[0]
    const cmakePath = service.resolveToolPath('cmake')
    const ctestPath = service.resolveToolPath('ctest')
    if (!candidate || !cmakePath || !ctestPath) return

    const probe = await service.probe(candidate.id)
    expect(probe.success).toBe(true)
    expect(probe.profile).toBeDefined()
    const buildDirectory = mkdtempSync(join(tmpdir(), 'cpppet-cmake-test-'))
    try {
      const projectRoot = resolve(import.meta.dirname, '../../../tests/fixtures-cpp/cmake-project')
      const build = await service.buildCmakeProject({
        profile: probe.profile!,
        cmakePath,
        projectRoot,
        buildDirectory,
        standard: 'c++17',
        configuration: 'Debug'
      })
      expect(build.success, [
        build.configure.stdout,
        build.configure.stderr,
        build.build?.stdout ?? '',
        build.build?.stderr ?? ''
      ].filter(Boolean).join('\n')).toBe(true)
      expect(build.compileCommandsGenerated).toBe(true)
      const compileCommands = readFileSync(join(buildDirectory, 'compile_commands.json'), 'utf8')
      expect(compileCommands).toContain(projectRoot.replaceAll('\\', '/'))
      expect(compileCommands).not.toContain(build.sourceDirectory.replaceAll('\\', '/'))
      const tests = await service.runCtest({ ctestPath, buildDirectory, configuration: 'Debug' })
      expect(tests.total, `${tests.process.stdout}\n${tests.process.stderr}`).toBe(1)
      expect(tests).toMatchObject({ success: true, total: 1, passed: 1, failed: 0 })
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 120_000)
})
