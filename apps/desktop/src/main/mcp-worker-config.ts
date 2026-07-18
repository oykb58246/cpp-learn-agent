import { join } from 'node:path'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'

export function createMcpWorkerParameters(
  executablePath: string,
  workerPath: string,
  userDataPath: string,
  environment: NodeJS.ProcessEnv = process.env
): StdioServerParameters {
  const env = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined))
  return {
    command: executablePath,
    args: [workerPath],
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      CPP_PILOT_MCP_DATABASE: join(userDataPath, 'data', 'cpp-pet.sqlite'),
      CPP_PILOT_MCP_SNAPSHOTS: join(userDataPath, 'snapshots'),
      CPP_PILOT_MCP_BUILDS: join(userDataPath, 'builds', 'agent')
    },
    stderr: 'pipe'
  }
}
