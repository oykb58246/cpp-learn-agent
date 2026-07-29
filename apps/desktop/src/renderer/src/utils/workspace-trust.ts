import type { Workspace } from '@cpp-pet/contracts'

interface WorkspaceTrustConfirmOptions {
  confirmButtonText: string
  cancelButtonText: string
  type: 'warning'
}

interface WorkspaceTrustDependencies {
  confirm: (message: string, title: string, options: WorkspaceTrustConfirmOptions) => Promise<unknown>
  trust: (workspaceId: string) => Promise<Workspace | null>
}

export async function requestWorkspaceTrust(
  workspace: Workspace,
  actionLabel: string,
  dependencies: WorkspaceTrustDependencies
): Promise<boolean> {
  if (workspace.trustState === 'trusted') return true

  try {
    await dependencies.confirm(
      `工作区“${workspace.name}”当前处于只读状态。为${actionLabel}，CppPilot 需要获得该目录的读写和本地工具执行权限。\n\n目录：${workspace.rootPath}`,
      '是否信任此工作区？',
      {
        confirmButtonText: '信任并继续',
        cancelButtonText: '保持只读',
        type: 'warning'
      }
    )
  } catch {
    return false
  }

  const trusted = await dependencies.trust(workspace.id)
  return trusted?.trustState === 'trusted'
}
