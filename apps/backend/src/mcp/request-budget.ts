export interface McpRequestLimits {
  maxBatch: number
  maxDepth: number
  maxElements: number
}

const DEFAULT_LIMITS: McpRequestLimits = { maxBatch: 20, maxDepth: 64, maxElements: 100_000 }

/**
 * Why a parsed JSON-RPC body is over budget, or null when it is within it. An
 * element is every array item and every object property value; the walk uses
 * an explicit stack, so a deeply nested body cannot overflow the call stack.
 */
export const mcpRequestBudgetError = (
  body: unknown,
  limits: McpRequestLimits = DEFAULT_LIMITS,
): string | null => {
  if (Array.isArray(body) && body.length > limits.maxBatch) {
    return `batch of more than ${limits.maxBatch} messages`
  }

  let elements = 0
  const stack: { value: unknown; depth: number }[] = [{ depth: 0, value: body }]
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { depth, value } = entry
    if (value === null || typeof value !== 'object') continue
    if (depth >= limits.maxDepth) return `nesting deeper than ${limits.maxDepth}`
    const children = Array.isArray(value) ? value : Object.values(value)
    elements += children.length
    if (elements > limits.maxElements) return `more than ${limits.maxElements} elements`
    for (const child of children) stack.push({ depth: depth + 1, value: child })
  }
  return null
}
