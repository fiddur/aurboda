const FULL_DETAIL_MAX_CHARS = 4096
const SUMMARY_STRING_MAX_CHARS = 200

const summarizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return { count: value.length }
  if (typeof value === 'string' && value.length > SUMMARY_STRING_MAX_CHARS) {
    return `${value.slice(0, SUMMARY_STRING_MAX_CHARS)}…`
  }
  if (value !== null && typeof value === 'object') return { keys: Object.keys(value).length }
  return value
}

/**
 * Audit `details` for a request or response body. Small bodies are kept whole;
 * bulk uploads (sync chunks up to 10 MB) are reduced to a shallow summary so
 * the audit log does not store every upload a second time.
 */
export const summarizeAuditBody = (body: unknown): Record<string, unknown> | undefined => {
  if (Array.isArray(body)) return { items: body.length }
  if (body === null || typeof body !== 'object') return undefined

  const redacted = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) =>
      k === 'password' ? [k, '[REDACTED]'] : [k, v],
    ),
  )
  if (JSON.stringify(redacted).length <= FULL_DETAIL_MAX_CHARS) return redacted

  return {
    ...Object.fromEntries(Object.entries(redacted).map(([k, v]) => [k, summarizeValue(v)])),
    _truncated: true,
  }
}
