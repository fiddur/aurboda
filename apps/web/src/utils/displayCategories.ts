export const DISPLAY_CATEGORY_ORDER = [
  'sleep_rest',
  'exercise',
  'meditation',
  'wellness',
  'health',
  'intake',
  'productivity',
  'travel',
  'other',
] as const

export const DISPLAY_CATEGORY_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  health: 'Health',
  intake: 'Intake',
  meditation: 'Meditation',
  other: 'Other',
  productivity: 'Productivity',
  sleep_rest: 'Sleep & Rest',
  travel: 'Travel',
  wellness: 'Wellness',
}

export const displayCategoryOptions: { label: string; value: string }[] = DISPLAY_CATEGORY_ORDER.map(
  (value) => ({ label: DISPLAY_CATEGORY_LABELS[value], value }),
)
