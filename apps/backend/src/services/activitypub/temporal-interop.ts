/// <reference lib="esnext.temporal" />
/**
 * Bridge a JS `Date` to the ambient `Temporal.Instant` that Fedify's vocab
 * expects for timestamp fields (`published`, `deleted`, …).
 *
 * Fedify types those fields as the ambient (esnext.temporal) `Temporal.Instant`,
 * but neither Fedify's runtime nor ours has a native `Temporal` (Node has none
 * yet) — both construct instants with `@js-temporal/polyfill`. The polyfill's
 * `Instant` is the *same class at runtime* (Fedify imports the same polyfill), so
 * passing one is correct; the two `Instant` types are only nominally different at
 * compile time (their method signatures differ slightly), which no type guard can
 * reconcile. This one boundary cast, confined here, keeps every call site
 * cast-free.
 *
 * The return type is the ambient global `Temporal.Instant` (from the triple-slash
 * lib reference above); the polyfill is imported under an alias so it doesn't
 * shadow that global type.
 */
import { Temporal as TemporalPolyfill } from '@js-temporal/polyfill'

export const dateToTemporalInstant = (date: Date): Temporal.Instant =>
  TemporalPolyfill.Instant.fromEpochMilliseconds(date.getTime()) as unknown as Temporal.Instant

/**
 * The reverse: an ambient `Temporal.Instant` (e.g. a received Note's `published`)
 * to a JS `Date`. `epochMilliseconds` is present on both the polyfill and the
 * ambient type, so no cast is needed.
 */
export const temporalInstantToDate = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds)
