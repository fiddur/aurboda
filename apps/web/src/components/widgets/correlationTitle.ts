import type { CorrelationConfig } from '@aurboda/api-spec'

/** The card title: the config's, else one naming the activity, or the flag's name (resolved at read time) for meal_sensitivity. */
export const correlationTitle = (
  config: Pick<CorrelationConfig, 'activity' | 'activity_type' | 'title'>,
  label: string | undefined,
): string =>
  config.title ??
  (config.activity_type === 'meal_sensitivity'
    ? `Meals with ${label ?? 'a sensitivity flag'} impact`
    : `${config.activity} impact`)
