import type { EnvironmentInstallTarget, ToolchainDetectionResult } from '@cpp-pet/contracts'

const requiredTools: Partial<Record<EnvironmentInstallTarget, ToolchainDetectionResult['tools'][number]['kind'][]>> = {
  llvm: ['clangd'],
  cmake: ['cmake', 'ctest'],
  vscode: ['vscode']
}

export function installationVerificationFailure(
  target: EnvironmentInstallTarget,
  detection: ToolchainDetectionResult
): string | undefined {
  const required = requiredTools[target]
  if (!required) return undefined
  const available = new Set(detection.tools.map(tool => tool.kind))
  const missing = required.filter(kind => !available.has(kind))
  return missing.length
    ? `WinGet 已结束，但未检测到 ${missing.join('、')}。请确认安装程序已完成且未被取消，然后重新检测。`
    : undefined
}

export function visiblePowerShellTerminalArguments(title: string, command: string): string[] {
  return [
    '/d', '/c', 'start', title, '/wait', 'powershell.exe',
    '-NoLogo', '-NoProfile', '-Command', command
  ]
}
