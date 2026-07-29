import { describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@cpp-pet/contracts'
import { requestWorkspaceTrust } from './workspace-trust'

const workspace: Workspace = {
  id: 'c789f364-06e4-4e5f-91a5-c318cf9021f0',
  name: 'CppPilotBuildTest',
  rootPath: 'F:/大二下/企业实训/CppPilotBuildTest',
  trustState: 'inspection',
  createdAt: '2026-07-29T10:00:00.000Z',
  lastOpenedAt: '2026-07-29T10:00:00.000Z'
}

describe('requestWorkspaceTrust', () => {
  it('continues immediately when the workspace is already trusted', async () => {
    const confirm = vi.fn()
    const trust = vi.fn()

    await expect(requestWorkspaceTrust({ ...workspace, trustState: 'trusted' }, '构建工程', { confirm, trust })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(trust).not.toHaveBeenCalled()
  })

  it('trusts the workspace and continues after confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined)
    const trust = vi.fn().mockResolvedValue({ ...workspace, trustState: 'trusted' })

    await expect(requestWorkspaceTrust(workspace, '构建工程', { confirm, trust })).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('CppPilotBuildTest'),
      '是否信任此工作区？',
      expect.objectContaining({ confirmButtonText: '信任并继续' })
    )
    expect(trust).toHaveBeenCalledWith(workspace.id)
  })

  it('keeps the workspace read-only when the user cancels', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('cancelled'))
    const trust = vi.fn()

    await expect(requestWorkspaceTrust(workspace, '运行程序', { confirm, trust })).resolves.toBe(false)
    expect(trust).not.toHaveBeenCalled()
  })

  it('does not continue when authorization fails', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined)
    const trust = vi.fn().mockResolvedValue(null)

    await expect(requestWorkspaceTrust(workspace, '启动调试', { confirm, trust })).resolves.toBe(false)
  })
})
