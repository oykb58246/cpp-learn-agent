import { z } from 'zod'
import { openAiFunctionToolSchema, type OpenAiFunctionTool } from '@cpp-pet/contracts'
import type { LocalToolDefinition } from './registry'

export interface ParsedOpenAiToolCall {
  definition: LocalToolDefinition
  arguments: Record<string, unknown>
}

export interface OpenAiToolRuntimeBindings {
  runId: string
}

export interface OpenAiToolRegistry {
  readonly tools: OpenAiFunctionTool[]
  resolve(functionName: string): LocalToolDefinition | undefined
  functionNameFor(mcpName: string): string | undefined
  parse(functionName: string, args: unknown, bindings?: OpenAiToolRuntimeBindings): ParsedOpenAiToolCall
}

export function createOpenAiToolRegistry(definitions: LocalToolDefinition[]): OpenAiToolRegistry {
  const byFunctionName = new Map<string, {
    definition: LocalToolDefinition
    runtimeManagedProperties: Set<string>
  }>()
  const byMcpName = new Map<string, string>()
  const tools = definitions.map(definition => {
    const functionName = openAiFunctionName(definition.name)
    if (byFunctionName.has(functionName)) throw new Error(`Duplicate OpenAI function alias: ${functionName}`)
    const raw = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>
    const { schema, properties: runtimeManagedProperties } = hideRuntimeManagedProperties(raw)
    byFunctionName.set(functionName, { definition, runtimeManagedProperties })
    byMcpName.set(definition.name, functionName)
    const parameters = strictSchema(schema)
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
    resolve: functionName => byFunctionName.get(functionName)?.definition,
    functionNameFor: mcpName => byMcpName.get(mcpName),
    parse(functionName, args, bindings) {
      const registered = byFunctionName.get(functionName)
      if (!registered) throw new Error(`Unknown OpenAI function: ${functionName}`)
      const withoutNulls = omitNullValues(args)
      const boundArguments = isRecord(withoutNulls) ? { ...withoutNulls } : withoutNulls
      if (registered.runtimeManagedProperties.has('runId')) {
        if (!bindings?.runId) throw new Error(`Runtime binding runId is required for ${functionName}`)
        if (!isRecord(boundArguments)) throw new Error(`OpenAI function arguments must be an object: ${functionName}`)
        boundArguments.runId = bindings.runId
      }
      return {
        definition: registered.definition,
        arguments: registered.definition.inputSchema.parse(boundArguments)
      }
    }
  }
}

function openAiFunctionName(name: string): string {
  const alias = name.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(alias)) throw new Error(`MCP tool name cannot be mapped to OpenAI: ${name}`)
  return alias
}

function hideRuntimeManagedProperties(value: Record<string, unknown>): {
  schema: Record<string, unknown>
  properties: Set<string>
} {
  const properties = isRecord(value.properties) ? { ...value.properties } : {}
  const runtimeManaged = new Set<string>()
  if (Object.hasOwn(properties, 'runId')) {
    runtimeManaged.add('runId')
    delete properties.runId
  }
  return {
    schema: {
      ...value,
      properties,
      ...(Array.isArray(value.required)
        ? { required: value.required.filter(item => item !== 'runId') }
        : {})
    },
    properties: runtimeManaged
  }
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
