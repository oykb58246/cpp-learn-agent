import { describe, expect, it } from 'vitest'
import { parseCompilerDiagnostics, parseCompilerVersion, runProcess, runtimeDiagnostics } from './index'

describe('cpp-local-tools', () => {
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
})
