import { describe, expect, it } from 'vitest'

import { activityRouteAfterSave } from './saveNavigation'

describe('activityRouteAfterSave', () => {
  it('returns the override route when the saved id differs from the URL id', () => {
    // PATCH on a synced (e.g. Garmin) source created a new aurboda override.
    // Page should navigate to it so the user sees their edits.
    expect(activityRouteAfterSave('override-uuid', 'garmin-uuid')).toBe('/detail/activity/override-uuid')
  })

  it('returns null when the saved id matches the URL id (in-place edit)', () => {
    // PATCH on an aurboda or already-overridden row returns the same id.
    // No navigation needed; stay on this page.
    expect(activityRouteAfterSave('aurboda-uuid', 'aurboda-uuid')).toBeNull()
  })

  it('returns null when the response id is missing (degenerate empty-body PATCH)', () => {
    // The mutation short-circuits before calling updateActivity in this case,
    // but the helper is defensive.
    expect(activityRouteAfterSave(undefined, 'any-uuid')).toBeNull()
  })
})
