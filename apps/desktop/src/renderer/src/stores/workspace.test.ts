import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FileDocument } from '@cpp-pet/contracts'
import { useWorkspaceStore, type OpenTab } from './workspace'

const now = new Date().toISOString()

function openTab(content: string, draft: string): OpenTab {
  return {
    projectId: crypto.randomUUID(),
    relativePath: 'main.cpp',
    content,
    contentHash: 'hash-old',
    modifiedAt: now,
    encoding: 'utf8',
    eol: 'lf',
    readOnly: false,
    draft,
    dirty: content !== draft,
    conflicted: false
  }
}

function savedDocument(tab: OpenTab, content: string, contentHash: string): FileDocument {
  return {
    projectId: tab.projectId,
    relativePath: tab.relativePath,
    content,
    contentHash,
    modifiedAt: now,
    encoding: tab.encoding,
    eol: tab.eol,
    readOnly: tab.readOnly
  }
}

describe('workspace Agent context synchronization', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('persists the active editor draft before Agent context can read the file', async () => {
    const tab = openTab('int main() { return 0; }', 'int main() { return 42; }')
    let diskContent = tab.content
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        files: {
          write: async (input: { content: string }) => {
            diskContent = input.content
            return { ok: true, data: savedDocument(tab, input.content, 'hash-new') }
          }
        }
      }
    } })
    const store = useWorkspaceStore()
    store.tabs = [tab]
    store.activePath = tab.relativePath

    const synchronized = await store.syncActiveDraftForAgent()

    expect(synchronized).toBe(true)
    expect(diskContent).toBe('int main() { return 42; }')
    expect(store.activeTab).toMatchObject({ content: diskContent, draft: diskContent, dirty: false, conflicted: false })
  })

  it('waits for an in-flight autosave and then persists the newest draft', async () => {
    const tab = openTab('version 0', 'version 1')
    let diskContent = tab.content
    let diskHash = tab.contentHash
    let releaseFirstWrite: (() => void) | undefined
    const writes: Array<{ content: string; expectedHash: string }> = []
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      cppPet: {
        files: {
          write: async (input: { content: string; expectedHash: string }) => {
            writes.push(input)
            if (writes.length === 1) {
              return await new Promise(resolve => {
                releaseFirstWrite = () => {
                  diskContent = input.content
                  diskHash = 'hash-version-1'
                  resolve({ ok: true, data: savedDocument(tab, diskContent, diskHash) })
                }
              })
            }
            if (input.expectedHash !== diskHash) {
              return { ok: false, error: { code: 'FILE_REVISION_CONFLICT', message: 'stale hash', retryable: true } }
            }
            diskContent = input.content
            diskHash = 'hash-version-2'
            return { ok: true, data: savedDocument(tab, diskContent, diskHash) }
          }
        }
      }
    } })
    const store = useWorkspaceStore()
    store.tabs = [tab]
    store.activePath = tab.relativePath

    const autosave = store.savePath(tab.relativePath)
    await Promise.resolve()
    store.edit('version 2')
    const synchronization = store.syncActiveDraftForAgent()
    releaseFirstWrite?.()

    await autosave
    expect(await synchronization).toBe(true)
    expect(writes.map(({ content, expectedHash }) => ({ content, expectedHash }))).toEqual([
      { content: 'version 1', expectedHash: 'hash-old' },
      { content: 'version 2', expectedHash: 'hash-version-1' }
    ])
    expect(diskContent).toBe('version 2')
    expect(store.activeTab).toMatchObject({ content: 'version 2', draft: 'version 2', dirty: false, conflicted: false })
  })
})
