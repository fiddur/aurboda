import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'

import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

type JsonSchema = Record<string, unknown>

interface TerseProperty {
  const?: unknown
  description?: string
  enum?: unknown[]
  format?: string
  items?: { type: string }
  type: string
}

export interface TerseInputSchema {
  properties?: Record<string, TerseProperty>
  required?: string[]
  type: 'object'
}

const isRecord = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAbbreviation = (head: string): boolean => /\b(?:e\.g|i\.e)\.$/i.test(head)

export const terseDescription = (text: string | undefined, max = 200): string | undefined => {
  if (text === undefined) return undefined
  const line = (text.trim().split('\n')[0] ?? '').trim()
  const sentence = [...line.matchAll(/[.!?](?=\s|$)/g)]
    .map((match) => line.slice(0, match.index + 1))
    .find((head) => !isAbbreviation(head))
  return (sentence ?? line).slice(0, max)
}

interface Resolved {
  schema: JsonSchema
  seen: ReadonlySet<string>
}

const resolveSchema = (
  schema: unknown,
  definitions: JsonSchema,
  seen: ReadonlySet<string> = new Set(),
): Resolved | undefined => {
  if (!isRecord(schema)) return undefined
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const prefix = '#/definitions/'
    const name = ref.slice(prefix.length)
    if (!ref.startsWith(prefix) || seen.has(name)) return undefined
    return resolveSchema(definitions[name], definitions, new Set(seen).add(name))
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1) {
    return resolveSchema(schema.allOf[0], definitions, seen)
  }
  return { schema, seen }
}

const alternativesOf = (schema: JsonSchema): unknown[] | undefined =>
  Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined

const typeOfValue = (value: unknown): string => (value === null ? 'null' : typeof value)

const deriveType = (schema: unknown, definitions: JsonSchema, seen?: ReadonlySet<string>): string => {
  const resolved = resolveSchema(schema, definitions, seen)
  if (!resolved) return 'any'
  const { schema: target, seen: path } = resolved
  if (typeof target.type === 'string') return target.type
  if (Array.isArray(target.type)) return target.type.map(String).join('|')
  const alternatives = alternativesOf(target)
  if (alternatives) {
    const types = [...new Set(alternatives.flatMap((alt) => deriveType(alt, definitions, path).split('|')))]
    const known = types.filter((type) => type !== 'any')
    return (known.length > 0 ? known : types).join('|')
  }
  if ('const' in target) return typeOfValue(target.const)
  if (Array.isArray(target.enum) && target.enum.length > 0) return typeOfValue(target.enum[0])
  return 'any'
}

const deriveEnum = (schema: JsonSchema, definitions: JsonSchema): unknown[] | undefined => {
  if (Array.isArray(schema.enum)) return schema.enum
  if (!Array.isArray(schema.anyOf)) return undefined
  const alternatives = schema.anyOf.map((alt) => resolveSchema(alt, definitions)?.schema)
  if (alternatives.some((alt) => !alt || (!Array.isArray(alt.enum) && alt.type !== 'null'))) return undefined
  const values = alternatives.flatMap((alt) => (Array.isArray(alt?.enum) ? alt.enum : []))
  return values.length > 0 ? values : undefined
}

const terseProperty = (property: unknown, definitions: JsonSchema): TerseProperty => {
  const resolved = resolveSchema(property, definitions)
  if (!resolved) return { type: 'any' }
  const { schema: target, seen } = resolved
  const enumValues = deriveEnum(target, definitions)
  const ownDescription = isRecord(property) ? property.description : undefined
  const description = typeof ownDescription === 'string' ? ownDescription : target.description
  return {
    type: deriveType(target, definitions, seen),
    ...(enumValues ? { enum: enumValues } : {}),
    ...('const' in target ? { const: target.const } : {}),
    ...(typeof target.format === 'string' ? { format: target.format } : {}),
    ...(isRecord(target.items) ? { items: { type: deriveType(target.items, definitions, seen) } } : {}),
    ...(typeof description === 'string' ? { description: terseDescription(description, 120) } : {}),
  }
}

export const terseInputSchema = (schema: JsonSchema): TerseInputSchema => {
  if (!isRecord(schema.properties)) return { type: 'object' }
  const definitions = isRecord(schema.definitions) ? schema.definitions : {}
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      try {
        return [name, terseProperty(property, definitions)]
      } catch {
        return [name, { type: 'any' }]
      }
    }),
  )
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : []
  return { properties, ...(required.length > 0 ? { required } : {}), type: 'object' }
}

const fullInputSchema = (tool: RegisteredTool): JsonSchema => {
  const objectSchema = normalizeObjectSchema(tool.inputSchema)
  return objectSchema
    ? toJsonSchemaCompat(objectSchema, { pipeStrategy: 'input', strictUnions: true })
    : { properties: {}, type: 'object' }
}

export const fullToolDefinition = (name: string, tool: RegisteredTool) => ({
  description: tool.description,
  input_schema: fullInputSchema(tool),
  name,
})

// Reads the SDK's private tool registry so every tool keeps its full registration (and
// server-side validation); the tools/list test in mcp.test.ts pins this assumption.
const registeredTools = (server: McpServer): Record<string, RegisteredTool> =>
  (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools

const enabledTools = (server: McpServer): [string, RegisteredTool][] =>
  Object.entries(registeredTools(server)).filter(([, tool]) => tool.enabled)

export const installToolCatalogue = (server: McpServer): void => {
  server.tool(
    'describe_tools',
    "Full description and complete JSON input schema (nested objects, enums, formats, examples) of one or more tools. The tool list only shows each tool's first sentence and its top-level parameters — call this before using a tool whose parameters are objects or arrays.",
    { names: z.array(z.string().min(1)).min(1).max(20).describe('Tool names, as listed') },
    async ({ names }) => {
      const tools = new Map(enabledTools(server))
      const known = names.flatMap((name) => {
        const tool = tools.get(name)
        return tool ? [fullToolDefinition(name, tool)] : []
      })
      const unknown = names.filter((name) => !tools.has(name))
      if (known.length === 0) return errorResponse(`Unknown tool(s): ${unknown.join(', ')}`)
      return jsonResponse({ tools: known, unknown })
    },
  )

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: enabledTools(server).map(([name, tool]) => ({
      _meta: tool._meta,
      annotations: tool.annotations,
      description: terseDescription(tool.description),
      ...(tool.execution?.taskSupport && tool.execution.taskSupport !== 'forbidden'
        ? { execution: tool.execution }
        : {}),
      inputSchema: terseInputSchema(fullInputSchema(tool)),
      name,
      title: tool.title,
    })),
  }))
}
