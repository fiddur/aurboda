/** The display categories drawn in the Timeline's Activity lane, and so on a day overview. */
export const ACTIVITY_LANE_CATEGORIES: ReadonlySet<string> = new Set([
  'sleep_rest',
  'exercise',
  'meditation',
  'wellness',
])

/** The sleep types a day overview draws as a shaded band behind the plot instead of an icon. */
export const isSleepType = (type: string, parentType: string | undefined): boolean =>
  type === 'sleep' || type === 'nap' || parentType === 'sleep'
