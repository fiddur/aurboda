/**
 * Formats a JavaScript value for use in PostgreSQL queries.
 * Note: For user input, prefer parameterized queries to prevent SQL injection.
 */
export const formatValue = (v: unknown): string =>
  Array.isArray(v) ? `'{ "${v.join('","')}" }'`
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? String(v)
  : v === null ? 'NULL'
  : typeof v === 'string' ? `'${(v as string).replaceAll("'", "''")}'`
  : `'${JSON.stringify(v).replaceAll("'", "''")}'`
