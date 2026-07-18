import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'cpppilot-stdio-test', version: '0.1.0' })
server.registerTool('workspace.list_files', {
  inputSchema: z.object({ projectId: z.string().uuid() })
}, async () => ({
  content: [{ type: 'text', text: 'stdio-ready' }],
  structuredContent: {
    ok: true,
    exitCode: 0,
    summary: 'stdio-ready',
    structuredContent: { transport: 'stdio' },
    diagnostics: [],
    artifacts: [],
    sideEffects: [],
    retryable: false,
    durationMs: 1
  }
}))

await server.connect(new StdioServerTransport())
