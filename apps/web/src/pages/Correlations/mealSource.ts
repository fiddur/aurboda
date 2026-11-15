import type { ActivityImpactData, ImpactGroup } from '@aurboda/api-spec'

export const mealsWithLabel = (flagName: string): string => `Meals with ${flagName}`

export const mealsWithoutLabel = (flagName: string): string =>
  `Meals without ${flagName}, on days with a complete meal log`

/** The comparison group as a breakdown group, so it is tabled beside the meals with the flag. */
export const comparisonAsGroup = (data: ActivityImpactData): ImpactGroup | null =>
  data.comparison
    ? {
        ...data.comparison,
        avg_duration_min: data.avg_duration_min,
        key: 'comparison',
        label: mealsWithoutLabel(data.activity),
      }
    : null
