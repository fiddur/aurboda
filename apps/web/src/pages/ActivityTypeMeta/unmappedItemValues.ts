export const UNMAPPED_PAGE_SIZE = 20

export const unmappedSummary = (count: number): string =>
  `${count} ${count === 1 ? 'exercise name is' : 'exercise names are'} not matched to the built-in catalogue.`

export const visibleUnmapped = <T>(values: T[], shown: number): { rows: T[]; remaining: number } => ({
  remaining: Math.max(0, values.length - shown),
  rows: values.slice(0, shown),
})
