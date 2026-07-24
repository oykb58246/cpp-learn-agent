import { describe, expect, it } from 'vitest'
import type { ToolchainDetectionResult } from '@cpp-pet/contracts'
import { installationVerificationFailure, visiblePowerShellTerminalArguments, wingetInstallCommand } from './environment-install'

const detection = (tools: ToolchainDetectionResult['tools']): ToolchainDetectionResult => ({
  candidates: [],
  tools,
  detectedAt: new Date().toISOString()
})

describe('installationVerificationFailure', () => {
  it('rejects an LLVM install when clangd is still missing', () => {
    const failure = installationVerificationFailure('llvm', detection([]))
    expect(failure).toContain('clangd')
    expect(failure).toContain('C:\\Program Files\\LLVM\\bin\\clangd.exe')
    expect(failure).toContain('PATH')
  })

  it('requires both CMake and CTest after a CMake install', () => {
    expect(installationVerificationFailure('cmake', detection([{ kind: 'cmake', path: 'C:\\CMake\\bin\\cmake.exe' }]))).toContain('ctest')
    expect(installationVerificationFailure('cmake', detection([
      { kind: 'cmake', path: 'C:\\CMake\\bin\\cmake.exe' },
      { kind: 'ctest', path: 'C:\\CMake\\bin\\ctest.exe' }
    ]))).toBeUndefined()
  })

  it('opens a visible PowerShell terminal and waits for its completion', () => {
    expect(visiblePowerShellTerminalArguments('CppPilot Install LLVM', 'winget install LLVM.LLVM')).toEqual([
      '/d', '/c', 'start', 'CppPilot Install LLVM', '/wait', 'powershell.exe',
      '-NoLogo', '-NoProfile', '-Command', 'winget install LLVM.LLVM'
    ])
  })

  it('treats WinGet no-applicable-upgrade as an installed package that still needs verification', () => {
    const command = wingetInstallCommand('LLVM', 'LLVM.LLVM')
    expect(command).toContain('$exitCode -eq -1978335189')
    expect(command).toContain('$exitCode -eq 2316632107')
    expect(command).toContain('已安装现有版本，且没有可用升级')
    expect(command).toContain('$exitCode = 0')
  })
})
