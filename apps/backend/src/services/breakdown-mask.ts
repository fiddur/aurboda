/**
 * Masking of breakdown series names for public shared boards.
 *
 * A breakdown chart splits an activity type into series by one or more
 * categorical fields; when multiple fields are used the series name is the
 * per-field values joined by ' / ' (e.g. `Alice / happy` for
 * `breakdown_fields: ['partner', 'mood']`). To keep sensitive values (a partner
 * name, a location…) off a *public* board while still showing the breakdown
 * structure, the owner can mark a subset of the fields as masked: those field
 * values are replaced with stable positional labels A, B, C…, resolved
 * server-side so the real values never reach a public viewer.
 */

const SERIES_DELIMITER = ' / '

/** Spreadsheet-style positional label: 0→A, 1→B, … 25→Z, 26→AA, 27→AB, … */
export function indexToLabel(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** Map distinct values (in sorted order) to stable positional labels. */
function labelMap(values: Iterable<string>): Map<string, string> {
  const distinct = [...new Set(values)].sort()
  return new Map(distinct.map((v, i) => [v, indexToLabel(i)]))
}

/**
 * Build a map from each real (composite) series name to its masked form, given
 * the ordered breakdown fields and the subset to mask. Returns an empty map
 * when nothing should change (no masked field is actually part of the
 * breakdown), so callers can treat a miss as identity.
 *
 * Per-field masking relies on splitting the composite name on ' / '. If any
 * name does not split into exactly one part per breakdown field (a real value
 * contained the delimiter), we cannot isolate fields safely, so we fall back to
 * masking the whole label — privacy-first: never leak a value we meant to hide.
 */
export function maskBreakdownNames(
  seriesNames: string[],
  breakdownFields: string[],
  maskedFields: string[],
): Map<string, string> {
  const maskedIndexes = breakdownFields
    .map((field, i) => (maskedFields.includes(field) ? i : -1))
    .filter((i) => i >= 0)

  if (maskedIndexes.length === 0 || seriesNames.length === 0) return new Map()

  const splitsCleanly = seriesNames.every(
    (name) => name.split(SERIES_DELIMITER).length === breakdownFields.length,
  )

  // Ambiguous composite names → mask the entire label rather than risk a leak.
  if (!splitsCleanly) {
    const whole = labelMap(seriesNames)
    return new Map(seriesNames.map((name) => [name, whole.get(name) ?? name]))
  }

  // Per masked field, letter its distinct values independently.
  const labelByIndex = new Map<number, Map<string, string>>()
  for (const i of maskedIndexes) {
    labelByIndex.set(i, labelMap(seriesNames.map((name) => name.split(SERIES_DELIMITER)[i])))
  }

  const result = new Map<string, string>()
  for (const name of seriesNames) {
    const masked = name
      .split(SERIES_DELIMITER)
      .map((part, i) => labelByIndex.get(i)?.get(part) ?? part)
      .join(SERIES_DELIMITER)
    result.set(name, masked)
  }
  return result
}
