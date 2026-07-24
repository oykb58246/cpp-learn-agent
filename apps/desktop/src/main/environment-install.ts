import type { EnvironmentInstallTarget, ToolchainDetectionResult } from '@cpp-pet/contracts'

const requiredTools: Partial<Record<EnvironmentInstallTarget, ToolchainDetectionResult['tools'][number]['kind'][]>> = {
  llvm: ['clangd'],
  cmake: ['cmake', 'ctest'],
  vscode: ['vscode']
}

const wingetNoApplicableUpgradeExitCodes = [-1978335189, 2316632107] as const

export function installationVerificationFailure(
  target: EnvironmentInstallTarget,
  detection: ToolchainDetectionResult
): string | undefined {
  const required = requiredTools[target]
  if (!required) return undefined
  const available = new Set(detection.tools.map(tool => tool.kind))
  const missing = required.filter(kind => !available.has(kind))
  if (target === 'llvm' && missing.includes('clangd')) {
    return 'WinGet 已结束，但仍未检测到 clangd。请确认 C:\\Program Files\\LLVM\\bin\\clangd.exe 是否存在；若 LLVM 安装在其他目录，请将其 bin 目录加入 PATH，重启 CppPilot 后重新检测。'
  }
  return missing.length
    ? `WinGet 已结束，但未检测到 ${missing.join('、')}。请确认安装程序已完成且未被取消，然后重新检测。`
    : undefined
}

export function wingetInstallCommand(label: string, packageId: string): string {
  const safeLabel = label.replaceAll("'", "''")
  const safePackageId = packageId.replaceAll("'", "''")
  const noUpgradeCheck = wingetNoApplicableUpgradeExitCodes.map(code => `$exitCode -eq ${code}`).join(' -or ')
  return [
    `Write-Host 'CppPilot 正在启动 ${safeLabel} 安装...' -ForegroundColor Cyan`,
    '$exitCode = 1',
    `try { winget install --id '${safePackageId}' --exact --source winget --interactive --accept-source-agreements --accept-package-agreements; $exitCode = $LASTEXITCODE } catch { Write-Error $_; $exitCode = 1 }`,
    `if (${noUpgradeCheck}) { Write-Host '已安装现有版本，且没有可用升级。CppPilot 将重新检测环境。' -ForegroundColor Yellow; $exitCode = 0 }`,
    `if ($exitCode -eq 0) { Write-Host '安装检查完成，CppPilot 将自动重新检测环境。' -ForegroundColor Green } else { Write-Host "安装未成功，退出码: $exitCode" -ForegroundColor Red }`,
    `if ($exitCode -ne 0) { Read-Host 'Installation failed. Press Enter to close.' }`,
    'Start-Sleep -Seconds 3',
    'exit $exitCode'
  ].join('; ')
}

export function visiblePowerShellTerminalArguments(title: string, command: string): string[] {
  return [
    '/d', '/c', 'start', title, '/wait', 'powershell.exe',
    '-NoLogo', '-NoProfile', '-Command', command
  ]
}
