import { describe, expect, it } from 'vitest'
import { createMcpWorkerParameters } from './mcp-worker-config'

describe('MCP worker configuration', () => {
  it('starts Electron as a Node stdio worker with isolated local paths', () => {
    const parameters = createMcpWorkerParameters('C:\\CppPilot\\CppPilot.exe', 'C:\\CppPilot\\out\\main\\mcp-worker.js', 'C:\\Users\\learner\\CppPilot', {
      PATH: 'C:\\Tools', SystemRoot: 'C:\\Windows'
    })

    expect(parameters).toMatchObject({
      command: 'C:\\CppPilot\\CppPilot.exe',
      args: ['C:\\CppPilot\\out\\main\\mcp-worker.js'],
      stderr: 'pipe',
      env: {
        PATH: 'C:\\Tools',
        SystemRoot: 'C:\\Windows',
        ELECTRON_RUN_AS_NODE: '1',
        CPP_PILOT_MCP_DATABASE: 'C:\\Users\\learner\\CppPilot\\data\\cpp-pet.sqlite',
        CPP_PILOT_MCP_SNAPSHOTS: 'C:\\Users\\learner\\CppPilot\\snapshots',
        CPP_PILOT_MCP_BUILDS: 'C:\\Users\\learner\\CppPilot\\builds\\agent'
      }
    })
  })
})
