import { z } from 'zod'
import { openAiFunctionToolSchema, type OpenAiFunctionTool } from '@cpp-pet/contracts'
import type { LocalToolDefinition } from './registry'

export interface ParsedOpenAiToolCall {
  definition: LocalToolDefinition
  arguments: Record<string, unknown>
}

export interface OpenAiToolRegistry {
  readonly tools: OpenAiFunctionTool[]
  resolve(functionName: string): LocalToolDefinition | undefined
  functionNameFor(mcpName: string): string | undefined
  parse(functionName: string, args: unknown): ParsedOpenAiToolCall
}

export function createOpenAiToolRegistry(definitions: LocalToolDefinition[]): OpenAiToolRegistry {
  const byFunctionName = new Map<string, LocalToolDefinition>()
  const byMcpName = new Map<string, string>()
  const tools = definitions.map(definition => {
    const functionName = openAiFunctionName(definition.name)
    if (byFunctionName.has(functionName)) throw new Error(`Duplicate OpenAI function alias: ${functionName}`)
    byFunctionName.set(functionName, definition)
    byMcpName.set(definition.name, functionName)
    const raw = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>
    const parameters = strictSchema(raw)
    return openAiFunctionToolSchema.parse({
      type: 'function',
      name: functionName,
      description: definition.description,
      strict: true,
      parameters
    })
  })

  return {
    tools,
    resolve: functionName => byFunctionName.get(functionName),
    functionNameFor: mcpName => byMcpName.get(mcpName),
    parse(functionName, args) {
      const definition = byFunctionName.get(functionName)
      if (!definition) throw new Error(`Unknown OpenAI function: ${functionName}`)
      const withoutNulls = omitNullValues(args)
      return { definition, arguments: definition.inputSchema.parse(withoutNulls) }
    }
  }
}

function openAiFunctionName(name: string): string {
  const alias = name.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(alias)) throw new Error(`MCP tool name cannot be mapped to OpenAI: ${name}`)
  return alias
}

function strictSchema(value: unknown): Record<string, unknown> {
  const normalized = normalizeNode(value)
  if (!isRecord(normalized) || normalized.type !== 'object') throw new Error('OpenAI function parameters must be an object schema')
  delete normalized.$schema
  return normalized
}

function normalizeNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNode)
  if (!isRecord(value)) return value
  const sourceProperties = isRecord(value.properties) ? value.properties : undefined
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '$schema' || key === 'default' || key === 'format') continue
    result[key] = normalizeNode(item)
  }
  if (result.type === 'object' && isRecord(result.properties)) {
    const originalRequired = new Set(Array.isArray(result.required) ? result.required.filter(item => typeof item === 'string') as string[] : [])
    const properties: Record<string, unknown> = {}
    for (const [key, property] of Object.entries(result.properties)) {
      const normalizedProperty = normalizeNode(property)
      const sourceProperty = sourceProperties?.[key]
      const acceptsOmission = !originalRequired.has(key) || (isRecord(sourceProperty) && Object.hasOwn(sourceProperty, 'default'))
      properties[key] = !acceptsOmission || allowsNull(normalizedProperty)
        ? normalizedProperty
        : { anyOf: [normalizedProperty, { type: 'null' }] }
    }
    result.properties = properties
    result.required = Object.keys(properties)
    result.additionalProperties = false
  }
  return result
}

function allowsNull(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.type === 'null') return true
  return Array.isArray(value.anyOf) && value.anyOf.some(allowsNull)
}

function omitNullValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullValues)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, omitNullValues(item)]))
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
