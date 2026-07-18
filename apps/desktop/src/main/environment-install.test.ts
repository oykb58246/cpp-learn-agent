import { describe, expect, it } from 'vitest'
import type { ToolchainDetectionResult } from '@cpp-pet/contracts'
import { installationVerificationFailure, visiblePowerShellTerminalArguments } from './environment-install'

const detection = (tools: ToolchainDetectionResult['tools']): ToolchainDetectionResult => ({
  candidates: [],
  tools,
  detectedAt: new Date().toISOString()
})

describe('installationVerificationFailure', () => {
  it('rejects an LLVM install when clangd is still missing', () => {
    expect(installationVerificationFailure('llvm', detection([]))).toContain('clangd')
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
})
