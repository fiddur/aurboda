/**
 * The `Date` ↔ `Temporal.Instant` boundary for Fedify's timestamp fields
 * (`published`, `deleted`, …).
 *
 * Fedify's vocab setters accept any spec `Temporal.Instant` through a duck-typed
 * guard, so a native one passes. Instants Fedify parses are built by its own
 * bundled polyfill, which is why `temporalInstantToDate` reads only
 * `epochMilliseconds`, present on both.
 */
export const dateToTemporalInstant = (date: Date): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime())

export const temporalInstantToDate = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds)
