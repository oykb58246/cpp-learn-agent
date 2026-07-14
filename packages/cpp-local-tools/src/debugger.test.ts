import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ToolchainService } from './index'
import { GdbMiSession } from './debugger'

describe('GdbMiSession', () => {
  it('runs a real breakpoint and step workflow when GCC and GDB are available', async () => {
    const service = new ToolchainService()
    const detection = await service.detect()
    const candidate = detection.candidates.find(item => item.family === 'gcc' && item.debuggerPath)
    if (!candidate) return
    const probe = await service.probe(candidate.id)
    if (!probe.success || !probe.profile?.debuggerPath) return

    const root = mkdtempSync(join(tmpdir(), 'cpppet-gdb-test-'))
    const sourcePath = join(root, 'main.cpp')
    const outputDirectory = join(root, 'build')
    mkdirSync(outputDirectory)
    writeFileSync(sourcePath, [
      '#include <iostream>',
      'int main() {',
      '  int value = 41;',
      '  value++;',
      "  std::cout << value << '\\n';",
      '  return 0;',
      '}'
    ].join('\n'), 'utf8')

    let session: GdbMiSession | undefined
    try {
      const build = await service.buildSingleFile({
        profile: probe.profile,
        projectRoot: root,
        sourcePath,
        sourceRelativePath: 'main.cpp',
        outputDirectory,
        standard: 'c++17',
        debugSymbols: true
      })
      expect(build.success, `${build.process.stdout}\n${build.process.stderr}`).toBe(true)

      session = new GdbMiSession(randomUUID(), probe.profile.debuggerPath, build.artifactPath, randomUUID(), root)
      const stopped = await session.initialize([{ path: sourcePath.replaceAll('\\', '/'), line: 4 }])
      expect(stopped).toMatchObject({ status: 'stopped', location: { relativePath: 'main.cpp', line: 4 } })
      expect(stopped.variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'value', value: '41' })]))

      const stepped = await session.execute('next')
      expect(stepped).toMatchObject({ status: 'stopped', location: { relativePath: 'main.cpp', line: 5 } })
      expect(stepped.variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'value', value: '42' })]))

      const exited = await session.execute('continue')
      expect(exited.status).toBe('exited')
    } finally {
      await session?.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
