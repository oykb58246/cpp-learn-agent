import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { ToolResult } from '@cpp-pet/contracts'
import { createLocalMcpServer, type LocalMcpAdapter } from './server'

const connected: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(connected.splice(0).map(item => item.close()))
})

async function setup(execute?: LocalMcpAdapter['execute']) {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  const adapter: LocalMcpAdapter = {
    async execute(name, args, context): Promise<ToolResult> {
      if (execute) return execute(name, args, context)
      calls.push({ name, arguments: args })
      return {
        ok: true,
        exitCode: 0,
        summary: `${name} completed`,
        structuredContent: { buildId: 'build-1' },
        diagnostics: [],
        artifacts: [],
        sideEffects: [],
        retryable: false,
        durationMs: 5
      }
    },
    async readResource(uri) {
      return { mimeType: 'application/json', text: JSON.stringify({ uri }) }
    }
  }
  const server = createLocalMcpServer(adapter)
  const client = new Client({ name: 'cpppilot-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  connected.push(client, server)
  return { client, calls }
}

describe('CppPilot local MCP server', () => {
  it('advertises real tools, resources and eight teaching prompts', async () => {
    const { client } = await setup()
    const tools = await client.listTools()
    const resources = await client.listResourceTemplates()
    const prompts = await client.listPrompts()

    expect(tools.tools.map(item => item.name)).toContain('compiler.build')
    expect(tools.tools.map(item => item.name)).toContain('workspace.apply_patch')
    expect(tools.tools.length).toBeGreaterThanOrEqual(20)
    expect(resources.resourceTemplates.map(item => item.uriTemplate)).toContain('cpplearn://project/{projectId}/files/{relativePath}')
    expect(prompts.prompts).toHaveLength(8)
  })

  it('calls an adapter through MCP and returns structured tool evidence', async () => {
    const { client, calls } = await setup()
    const projectId = crypto.randomUUID()
    const result = await client.callTool({
      name: 'compiler.build',
      arguments: { runId: crypto.randomUUID(), projectId, relativePath: 'main.cpp', standard: 'c++17' }
    })

    expect(calls).toEqual([{ name: 'compiler.build', arguments: expect.objectContaining({ projectId, relativePath: 'main.cpp' }) }])
    expect('structuredContent' in result && result.structuredContent).toMatchObject({ ok: true, exitCode: 0 })
  })

  it('rejects a path traversal before invoking the adapter', async () => {
    const { client, calls } = await setup()
    const result = await client.callTool({
      name: 'workspace.read_file',
      arguments: { projectId: crypto.randomUUID(), relativePath: '../secret.txt' }
    })

    expect('isError' in result && result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('forwards structured tool progress to the MCP client', async () => {
    const { client } = await setup(async (_name, _args, context) => {
      await context.onProgress(1, 2, '完成一半')
      return { ok: true, exitCode: 0, summary: 'done', diagnostics: [], artifacts: [], sideEffects: [], retryable: false, durationMs: 1 }
    })
    const progress: Array<{ progress: number; total?: number | undefined; message?: string | undefined }> = []

    await client.callTool({ name: 'toolchain.detect_compilers', arguments: {} }, undefined, { onprogress: event => progress.push(event) })

    expect(progress).toEqual([{ progress: 1, total: 2, message: '完成一半' }])
  })

  it('propagates client cancellation to the adapter AbortSignal', async () => {
    let aborted = false
    let markStarted!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const { client } = await setup(async (_name, _args, context) => new Promise<ToolResult>((_resolve, reject) => {
      markStarted()
      context.signal.addEventListener('abort', () => { aborted = true; reject(context.signal.reason) }, { once: true })
    }))
    const controller = new AbortController()

    const request = client.callTool({ name: 'toolchain.detect_compilers', arguments: {} }, undefined, { signal: controller.signal })
    await started
    controller.abort(new Error('cancel test'))

    await expect(request).rejects.toThrow()
    await expect.poll(() => aborted).toBe(true)
  })

  it('cancels the adapter when an MCP request times out', async () => {
    let aborted = false
    const { client } = await setup(async (_name, _args, context) => new Promise<ToolResult>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => { aborted = true; reject(context.signal.reason) }, { once: true })
    }))

    const request = client.callTool({ name: 'toolchain.detect_compilers', arguments: {} }, undefined, { timeout: 20 })

    await expect(request).rejects.toThrow()
    await expect.poll(() => aborted).toBe(true)
  })
})
