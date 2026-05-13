/** Convert snake_case to Title Case for display. */
export const toDisplayName = (s: string): string =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
