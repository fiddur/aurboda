/** "avg N min", or null for point activities, which have no duration. */
export const formatAvgDuration = (avgDurationMin: number | null | undefined): string | null =>
  avgDurationMin === null || avgDurationMin === undefined ? null : `avg ${avgDurationMin} min`

/** Occurrence count for an HRV-context row, with the average duration when there is one. */
export const describeOccurrences = (
  occurrences: number,
  avgDurationMin: number | null | undefined,
): string => {
  const avg = formatAvgDuration(avgDurationMin)
  return avg ? `${occurrences}× (${avg})` : `${occurrences}×`
}

/** "1 occurrence, avg 29 min" / "3 occurrences" for the impact chart's heading. */
export const describeImpactMeta = (
  occurrences: number,
  avgDurationMin: number | null | undefined,
): string => {
  const count = `${occurrences} ${occurrences === 1 ? 'occurrence' : 'occurrences'}`
  const avg = formatAvgDuration(avgDurationMin)
  return avg ? `${count}, ${avg}` : count
}

/** "6 months", "1 year", "5 years" for an impact period of whole half-years or years. */
export const impactPeriodLabel = (days: number): string => {
  if (days < 365) return `${Math.round(days / 30)} months`
  const years = Math.round(days / 365)
  return years === 1 ? '1 year' : `${years} years`
}

/** The heading's meta, with the period when the impact has its own instead of the table's. */
export const withImpactPeriod = (meta: string, impactDays: number | null): string =>
  impactDays === null ? meta : `${meta} · last ${impactPeriodLabel(impactDays)}`

/** " · incl. 2 subtypes" after a parent type's occurrences. */
export const describeSubtypeCount = (count: number): string =>
  count === 0 ? '' : ` · incl. ${count} ${count === 1 ? 'subtype' : 'subtypes'}`

/** "Includes Trail running, Hot yoga" for a parent type's row, or undefined without subtypes. */
export const subtypesTitle = (displayNames: readonly string[]): string | undefined =>
  displayNames.length === 0 ? undefined : `Includes ${displayNames.join(', ')}`
