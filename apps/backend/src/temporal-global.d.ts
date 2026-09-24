// Native Temporal API is provided by Node 26+ (V8). TypeScript ships no
// Temporal types yet, so we borrow them from the @js-temporal/polyfill
// devDependency.
import type { Temporal as TemporalImpl } from '@js-temporal/polyfill'

declare global {
  // Type-side: a namespace mirroring the polyfill's, so `Temporal.PlainDate`
  // works in type positions.
  namespace Temporal {
    export type Instant = TemporalImpl.Instant
    export type PlainDate = TemporalImpl.PlainDate
    export type PlainDateTime = TemporalImpl.PlainDateTime
    export type PlainTime = TemporalImpl.PlainTime
    export type PlainYearMonth = TemporalImpl.PlainYearMonth
    export type PlainMonthDay = TemporalImpl.PlainMonthDay
    export type ZonedDateTime = TemporalImpl.ZonedDateTime
    export type Duration = TemporalImpl.Duration
  }

  // Value-side: the runtime namespace object.
  const Temporal: typeof TemporalImpl
}

export {}
