import type { EnvironmentInstallTarget, EnvironmentInstallTask } from '@cpp-pet/contracts'

const labels: Record<EnvironmentInstallTarget, string> = {
  msys2: 'MSYS2 + UCRT64',
  llvm: 'LLVM 工具集',
  cmake: 'CMake',
  vscode: 'Visual Studio Code'
}

export function environmentInstallOutcome(task: EnvironmentInstallTask): { message: string; redetect: boolean; tone: 'neutral' | 'success' | 'error' } {
  if (task.status === 'running') {
    return { message: `${labels[task.target]}安装终端正在运行。`, redetect: false, tone: 'neutral' }
  }
  if (task.verificationFailure) {
    return { message: task.verificationFailure, redetect: false, tone: 'error' }
  }
  if (task.status === 'succeeded' && task.target === 'msys2') {
    return {
      message: 'MSYS2 本体安装完成。请打开 MSYS2 UCRT64，执行页面中的 pacman 命令，再返回重新检测。',
      redetect: true,
      tone: 'success'
    }
  }
  if (task.status === 'succeeded') {
    return { message: `${labels[task.target]}安装完成，正在自动重新检测环境…`, redetect: true, tone: 'success' }
  }
  const exit = task.exitCode === null || task.exitCode === undefined ? '' : `（退出码 ${task.exitCode}）`
  return { message: `${labels[task.target]}安装未成功${exit}，可以重试或改用官网安装。`, redetect: false, tone: 'error' }
}
