import { isPeopleBreakdownField } from '@aurboda/api-spec'

import { activityPeopleLateralSql, type BreakdownPerson } from '../db/index.ts'

export const NONE_LABEL = '(none)'

/**
 * Each person's series label: their name, with ` (2)`, ` (3)`… on the later of distinct people
 * sharing it (by `created_at`, then id), so same-named people stay separate series.
 */
export const personSeriesLabels = (people: Iterable<BreakdownPerson>): Map<string, string> => {
  const distinct = [...new Map([...people].map((p) => [p.id, p])).values()].toSorted(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
  )
  const seen = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const p of distinct) {
    const n = (seen.get(p.name) ?? 0) + 1
    seen.set(p.name, n)
    labels.set(p.id, n === 1 ? p.name : `${p.name} (${n})`)
  }
  return labels
}

const SCALAR_FIELD = /^[a-z][a-z0-9_]*$/

export interface ActivityBreakdownSql {
  /** Select-list columns `field_<i>` (and, for `@people`, `field_<i>_id` and `field_<i>_created`). */
  columns: string[]
  groupBy: string[]
  /** The people join, when `@people` is among the fields; empty otherwise. */
  join: string
}

/**
 * SQL for breaking down rows of `activities ${alias}` by scalar data fields and `@people`, or
 * undefined when a field is neither (the field names go into the SQL, so nothing else is allowed).
 */
export const activityBreakdownSql = (fields: string[], alias: string): ActivityBreakdownSql | undefined => {
  if (!fields.every((f) => isPeopleBreakdownField(f) || SCALAR_FIELD.test(f))) return undefined
  const columns: string[] = []
  const groupBy: string[] = []
  fields.forEach((f, i) => {
    if (isPeopleBreakdownField(f)) {
      columns.push(
        `ppl.person_id::text AS field_${i}_id`,
        `ppl.person_name AS field_${i}`,
        `ppl.person_created_at AS field_${i}_created`,
      )
      groupBy.push(`field_${i}_id`, `field_${i}`, `field_${i}_created`)
    } else {
      columns.push(`COALESCE(${alias}.data->>'${f}', '${NONE_LABEL}') AS field_${i}`)
      groupBy.push(`field_${i}`)
    }
  })
  return {
    columns,
    groupBy,
    join: fields.some(isPeopleBreakdownField) ? activityPeopleLateralSql(alias) : '',
  }
}

/** The series key of each row of an `activityBreakdownSql` query: its field values joined by ` / `. */
export const breakdownSeriesKeys = (rows: Record<string, unknown>[], fields: string[]): string[] => {
  const peopleIndexes = fields.flatMap((f, i) => (isPeopleBreakdownField(f) ? [i] : []))
  const labels = personSeriesLabels(
    rows.flatMap((row) =>
      peopleIndexes.flatMap((i) =>
        row[`field_${i}_id`] == null
          ? []
          : [
              {
                created_at: row[`field_${i}_created`] as Date,
                id: row[`field_${i}_id`] as string,
                name: row[`field_${i}`] as string,
              },
            ],
      ),
    ),
  )
  return rows.map((row) =>
    fields
      .map((f, i) => {
        if (!isPeopleBreakdownField(f)) return row[`field_${i}`] as string
        const id = row[`field_${i}_id`] as string | null
        return id == null ? NONE_LABEL : (labels.get(id) ?? NONE_LABEL)
      })
      .join(' / '),
  )
}
