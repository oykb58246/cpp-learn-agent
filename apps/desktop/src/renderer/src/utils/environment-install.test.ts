import { describe, expect, it } from 'vitest'
import type { EnvironmentInstallTask } from '@cpp-pet/contracts'
import { environmentInstallOutcome } from './environment-install'

const task = (patch: Partial<EnvironmentInstallTask>): EnvironmentInstallTask => ({
  taskId: crypto.randomUUID(),
  target: 'llvm',
  packageId: 'LLVM.LLVM',
  status: 'running',
  startedAt: new Date().toISOString(),
  ...patch
})

describe('environmentInstallOutcome', () => {
  it('requests a rescan after a successful tracked install', () => {
    expect(environmentInstallOutcome(task({ status: 'succeeded', exitCode: 0 }))).toMatchObject({ redetect: true, tone: 'success' })
  })

  it('keeps the MSYS2 package follow-up explicit', () => {
    const result = environmentInstallOutcome(task({ target: 'msys2', packageId: 'MSYS2.MSYS2', status: 'succeeded', exitCode: 0 }))
    expect(result.redetect).toBe(true)
    expect(result.message).toContain('MSYS2 UCRT64')
    expect(result.message).toContain('pacman')
  })

  it('reports failures without triggering a rescan', () => {
    expect(environmentInstallOutcome(task({ status: 'failed', exitCode: 5 }))).toEqual({
      redetect: false,
      tone: 'error',
      message: 'LLVM 工具集安装未成功（退出码 5），可以重试或改用官网安装。'
    })
  })

  it('shows the tool verification failure instead of reporting a false install success', () => {
    expect(environmentInstallOutcome(task({
      status: 'failed',
      exitCode: 0,
      verificationFailure: 'WinGet 已结束，但未检测到 clangd。'
    }))).toEqual({
      redetect: false,
      tone: 'error',
      message: 'WinGet 已结束，但未检测到 clangd。'
    })
  })
})
