export const UNTRIMMED_KEYS: ReadonlySet<string> = new Set([
  'content',
  'current_password',
  'markdown',
  'message_pattern',
  'new_password',
  'outcome_pattern',
  'password',
  'pattern',
  'regex',
  'response_json',
  'rule_regex',
  'strip_pattern',
])

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export const trimStrings = (value: unknown): unknown => {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(trimStrings)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        UNTRIMMED_KEYS.has(key) ? entry : trimStrings(entry),
      ]),
    )
  }
  return value
}
