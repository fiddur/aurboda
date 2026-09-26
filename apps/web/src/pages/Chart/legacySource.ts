import type { ScreentimeCategory } from '@aurboda/api-spec'

type Aggregation = 'count' | 'mean' | 'sum'

/**
 * Old Chart Explorer URLs picked a screentime category by path
 * (`source_type=productivity_category&pattern=Work > Dev`). Each category is
 * now reached through its activity type, so such a URL maps to that type,
 * summing hours unless the URL asked for another aggregation.
 */
export const mapLegacyCategorySource = (
  legacy: { aggregation?: Aggregation; pattern: string },
  categories: Pick<ScreentimeCategory, 'activity_type_name' | 'name'>[],
): { aggregation: Aggregation; pattern: string; source_type: 'activity_type' } => {
  const category = categories.find((c) => c.name.join(' > ') === legacy.pattern)
  return {
    aggregation: legacy.aggregation ?? 'sum',
    pattern: category?.activity_type_name ?? '',
    source_type: 'activity_type',
  }
}
