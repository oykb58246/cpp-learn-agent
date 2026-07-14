import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Diagnostic } from '@cpp-pet/contracts'
import { ClangdSession } from './language-server'

describe('ClangdSession', () => {
  it('handles LSP framing, document sync and language features', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpppet-lsp-test-'))
    const sourcePath = join(root, 'main.cpp')
    writeFileSync(sourcePath, 'int main() {\n  int value = 1;\n  return value;\n}\n', 'utf8')
    let resolveDiagnostics: ((value: Diagnostic[]) => void) | undefined
    const diagnosticsReady = new Promise<Diagnostic[]>(resolve => { resolveDiagnostics = resolve })
    const server = resolve(import.meta.dirname, 'fixtures/fake-lsp-server.mjs')
    const session = new ClangdSession(
      process.execPath,
      '00000000-0000-4000-8000-000000000001',
      root,
      undefined,
      (_path, diagnostics) => resolveDiagnostics?.(diagnostics),
      [server]
    )

    try {
      await session.sync('main.cpp', sourcePath, 'int main() {\n  int value = 1;\n  return value;\n}\n', 1)
      await expect(diagnosticsReady).resolves.toMatchObject([{
        source: 'clangd',
        severity: 'warning',
        code: 'fake-warning',
        file: 'main.cpp',
        line: 2,
        column: 5
      }])
      await expect(session.completion(sourcePath, { line: 2, character: 9 })).resolves.toMatchObject([{
        label: 'value',
        detail: 'int value',
        documentation: '**fake completion**'
      }])
      await expect(session.hover(sourcePath, { line: 2, character: 9 })).resolves.toEqual({
        contents: '```cpp\nint value\n```'
      })
      await expect(session.definition(sourcePath, { line: 2, character: 9 })).resolves.toEqual({
        relativePath: 'main.cpp',
        line: 2,
        column: 5
      })
    } finally {
      await session.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
