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
 * Skips stringifying a (up to 10 MB) body whose size is already settled: an
 * array of n items serializes to at least 2n + 1 chars and a string of n chars
 * to at least n + 2, so either one alone takes the body over the limit.
 */
const certainlyOverLimit = (values: unknown[]): boolean =>
  values.some(
    (v) =>
      (Array.isArray(v) && v.length > FULL_DETAIL_MAX_CHARS / 2) ||
      (typeof v === 'string' && v.length > FULL_DETAIL_MAX_CHARS),
  )

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
  if (
    !certainlyOverLimit(Object.values(redacted)) &&
    JSON.stringify(redacted).length <= FULL_DETAIL_MAX_CHARS
  ) {
    return redacted
  }

  return {
    ...Object.fromEntries(Object.entries(redacted).map(([k, v]) => [k, summarizeValue(v)])),
    _truncated: true,
  }
}
