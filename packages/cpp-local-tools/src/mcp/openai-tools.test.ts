import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { localToolDefinitions } from './registry'
import { createOpenAiToolRegistry } from './openai-tools'

describe('MCP to OpenAI function registry', () => {
  it('converts every local tool into one unique strict function', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const names = registry.tools.map(tool => tool.name)

    expect(registry.tools).toHaveLength(localToolDefinitions.length)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining([
      'workspace_apply_patch', 'compiler_build', 'learning_get_state',
      'learning_record_error', 'learning_update_state'
    ]))
    for (const tool of registry.tools) {
      expect(tool).toMatchObject({ type: 'function', strict: true })
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties as Record<string, unknown>))
    }
  })

  it('round-trips aliases and validates arguments with the original Zod schema', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const projectId = crypto.randomUUID()
    const parsed = registry.parse('workspace_read_file', { projectId, relativePath: 'src/main.cpp' })

    expect(parsed.definition.name).toBe('workspace.read_file')
    expect(parsed.arguments).toEqual({ projectId, relativePath: 'src/main.cpp' })
    expect(registry.functionNameFor('workspace.read_file')).toBe('workspace_read_file')
    expect(() => registry.parse('workspace_read_file', { projectId, relativePath: '../secret.txt' })).toThrow()
    expect(() => registry.parse('unknown_tool', {})).toThrow(/Unknown OpenAI function/)
  })

  it('uses null for strict optional fields and restores local defaults before execution', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const runId = crypto.randomUUID()
    const tool = registry.tools.find(item => item.name === 'program_run')!
    const properties = tool.parameters.properties as Record<string, any>

    expect(properties).not.toHaveProperty('runId')
    expect(tool.parameters.required).not.toContain('runId')
    expect(properties.input.anyOf).toContainEqual({ type: 'null' })
    expect(properties.timeoutMs.anyOf).toContainEqual({ type: 'null' })
    expect(registry.parse('program_run', {
      buildId: 'build-1', input: null, timeoutMs: null
    }, { runId }).arguments).toEqual({
      runId, buildId: 'build-1', input: '', timeoutMs: 5_000
    })
  })

  it('overrides a model-supplied runId with the runtime binding', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const runId = crypto.randomUUID()
    const projectId = crypto.randomUUID()

    expect(registry.parse('compiler_build', {
      runId: crypto.randomUUID(), projectId, relativePath: 'main.cpp', standard: 'c++17'
    }, { runId }).arguments).toEqual({
      runId, projectId, relativePath: 'main.cpp', standard: 'c++17'
    })
  })

  it('hides runId from every model-facing tool that uses the runtime binding', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const names = localToolDefinitions.flatMap(definition => {
      const schema = z.toJSONSchema(definition.inputSchema) as Record<string, any>
      return Object.hasOwn(schema.properties ?? {}, 'runId')
        ? [registry.functionNameFor(definition.name)]
        : []
    })

    expect(names).toHaveLength(7)
    for (const name of names) {
      expect(name).toBeTypeOf('string')
      const parameters = registry.tools.find(tool => tool.name === name)?.parameters
      expect(parameters, name).toBeDefined()
      expect(parameters?.properties, name).not.toHaveProperty('runId')
      expect(parameters?.required, name).not.toContain('runId')
    }
  })

  it.each([null, [], 'invalid', 42])('rejects non-object runtime-managed arguments: %j', value => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    expect(() => registry.parse('compiler_build', value, { runId: crypto.randomUUID() })).toThrow(/object/i)
  })

  it('does not expose unsupported defaults, formats, or refinements to OpenAI', () => {
    const registry = createOpenAiToolRegistry(localToolDefinitions)
    const serialized = JSON.stringify(registry.tools)

    expect(serialized).not.toContain('"default"')
    expect(serialized).not.toContain('"format"')
    expect(serialized).not.toContain('Path must stay inside the project root')
  })
})
