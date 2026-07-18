import { AppDatabase } from '@cpp-pet/database'
import { ToolchainService, startLocalMcpStdio } from '@cpp-pet/cpp-local-tools'
import { WorkspaceService } from '@cpp-pet/workspace-core'
import { DesktopMcpAdapter } from './agent-integration'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing MCP worker environment: ${name}`)
  return value
}

const database = new AppDatabase(requiredEnvironment('CPP_PILOT_MCP_DATABASE'))
const workspaceService = new WorkspaceService(database, requiredEnvironment('CPP_PILOT_MCP_SNAPSHOTS'))
const adapter = new DesktopMcpAdapter({
  db: database,
  workspaceService,
  toolchainService: new ToolchainService(),
  buildRoot: requiredEnvironment('CPP_PILOT_MCP_BUILDS')
})

try {
  await startLocalMcpStdio(adapter)
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  database.close()
  process.exitCode = 1
}
