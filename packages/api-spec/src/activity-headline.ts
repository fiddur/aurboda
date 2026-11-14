/** Prettify a snake_case key into a label (`hr_zone_minutes` → `Hr zone minutes`). */
export const prettifyKey = (key: string): string => {
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * A shared activity's headline: its title, else its prettified type (`Running activity`). The
 * federated Note, the link-preview card and the web feed card all read it from here, so an
 * untitled post says the same thing everywhere.
 */
export const activityHeadline = (title: string | undefined, activityType: string): string =>
  title ?? `${prettifyKey(activityType)} activity`
