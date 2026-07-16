import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { toolResultSchema, type ToolResult } from '@cpp-pet/contracts'
import { localToolDefinitions } from './registry'
import { registerTeachingPrompts } from './prompts'

export interface LocalMcpExecutionContext {
  signal: AbortSignal
  onProgress(progress: number, total: number | undefined, message: string): Promise<void>
}

export interface LocalMcpAdapter {
  execute(name: string, args: Record<string, unknown>, context: LocalMcpExecutionContext): Promise<ToolResult>
  readResource(uri: string, signal: AbortSignal): Promise<{ mimeType: string; text: string }>
}

const resourceTemplates = [
  ['project-tree', 'cpplearn://project/{projectId}/tree'],
  ['project-file', 'cpplearn://project/{projectId}/files/{relativePath}'],
  ['project-diagnostics', 'cpplearn://project/{projectId}/diagnostics/latest'],
  ['project-problem', 'cpplearn://project/{projectId}/problem'],
  ['learner-knowledge', 'cpplearn://learner/{userId}/knowledge-state'],
  ['learner-errors', 'cpplearn://learner/{userId}/error-book'],
  ['agent-run', 'cpplearn://run/{runId}']
] as const

export function createLocalMcpServer(adapter: LocalMcpAdapter): McpServer {
  const server = new McpServer({ name: 'cpppilot-local-tools', version: '0.1.0' }, { capabilities: { logging: {} } })

  for (const definition of localToolDefinitions) {
    server.registerTool(definition.name, {
      title: definition.title,
      description: `${definition.description}（风险 ${definition.risk}，超时 ${definition.timeoutMs}ms）`,
      inputSchema: definition.inputSchema,
      outputSchema: toolResultSchema,
      annotations: {
        title: definition.title,
        readOnlyHint: definition.risk === 'L0',
        destructiveHint: definition.risk === 'L3',
        idempotentHint: definition.risk === 'L0' || definition.risk === 'L1',
        openWorldHint: false
      },
      _meta: { 'cpppilot/risk': definition.risk, 'cpppilot/timeoutMs': definition.timeoutMs, 'cpppilot/owner': 'cpp-local-tools' }
    }, async (args, extra) => {
      const parsed = definition.inputSchema.parse(args)
      const result = toolResultSchema.parse(await adapter.execute(definition.name, parsed, {
        signal: extra.signal,
        onProgress: async (progress, total, message) => {
          const progressToken = extra._meta?.progressToken
          if (progressToken === undefined) return
          await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, ...(total === undefined ? {} : { total }), message } })
        }
      }))
      return { content: [{ type: 'text', text: result.summary }], structuredContent: result as unknown as Record<string, unknown>, isError: !result.ok }
    })
  }

  for (const [name, template] of resourceTemplates) {
    server.registerResource(name, new ResourceTemplate(template, { list: undefined }), {
      title: name,
      description: `CppPilot ${name} resource`,
      mimeType: 'application/json'
    }, async (uri, _variables, extra) => {
      const resource = await adapter.readResource(uri.toString(), extra.signal)
      return { contents: [{ uri: uri.toString(), mimeType: resource.mimeType, text: resource.text }] }
    })
  }

  registerTeachingPrompts(server)
  return server
}

export async function startLocalMcpStdio(adapter: LocalMcpAdapter): Promise<McpServer> {
  const server = createLocalMcpServer(adapter)
  await server.connect(new StdioServerTransport())
  return server
}

