/**
 * After PATCH /activities/:id, decide whether to navigate. PATCHing a synced
 * source returns the override's id (different from the URL's id) — we route
 * there so the page reflects the user's edits. PATCHing an aurboda /
 * already-overridden row returns the same id back; no navigation needed.
 *
 * Returns the URL to route to, or null when the page should stay put.
 *
 * Pure: extracted into its own module so the unit test can import it
 * without dragging in the rest of `index.tsx` (which pulls in axios +
 * runtime-window config).
 */
export const activityRouteAfterSave = (resultId: string | undefined, rawEntityId: string): string | null =>
  resultId && resultId !== rawEntityId ? `/detail/activity/${resultId}` : null
