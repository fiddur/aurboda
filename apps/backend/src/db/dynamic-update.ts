export type UpdateEntry = { column: string; value: unknown } | { expression: string; values: unknown[] }

const isExpression = (entry: UpdateEntry): entry is { expression: string; values: unknown[] } =>
  'expression' in entry

/**
 * Returns null if there are no SET clauses to apply (no fields and no defaults).
 *
 * @param options.defaultClauses - Static SET clauses always included (e.g. "updated_at = NOW()")
 * @param options.idColumn - Column name for WHERE (default: "id")
 */
export const buildDynamicUpdate = (
  table: string,
  idValue: unknown,
  fields: UpdateEntry[],
  options: { defaultClauses?: string[]; returning: string; idColumn?: string },
): { sql: string; params: unknown[] } | null => {
  const setClauses: string[] = [...(options.defaultClauses ?? [])]
  const params: unknown[] = []
  let paramIndex = 1

  for (const entry of fields) {
    if (isExpression(entry)) {
      let expr = entry.expression
      for (const val of entry.values) {
        expr = expr.replace('$NEXT', `$${paramIndex++}`)
        params.push(val)
      }
      setClauses.push(expr)
    } else {
      setClauses.push(`${entry.column} = $${paramIndex++}`)
      params.push(entry.value)
    }
  }

  if (setClauses.length === 0) return null

  const idColumn = options.idColumn ?? 'id'
  params.push(idValue)

  return {
    params,
    sql: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${idColumn} = $${paramIndex} RETURNING ${options.returning}`,
  }
}
