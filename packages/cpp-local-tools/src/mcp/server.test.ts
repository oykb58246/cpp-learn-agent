import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { ToolResult } from '@cpp-pet/contracts'
import { createLocalMcpServer, type LocalMcpAdapter } from './server'

const connected: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(connected.splice(0).map(item => item.close()))
})

async function setup() {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  const adapter: LocalMcpAdapter = {
    async execute(name, args): Promise<ToolResult> {
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
})
