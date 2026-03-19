# Plan: Calorie Source Separation & Timezone-Aware Gap-Fill

## Problem

Gap-fill and HR-based calorie computation both use `source: 'aurboda'`. When gap-fill runs
before HR data arrives (common with out-of-order syncs), it permanently occupies minute slots,
and subsequent HR-based computation skips them ("all minutes already computed"). This causes
exercise periods with 170+ bpm heart rate to show only the tiny gap-fill baseline value.

Additionally, the Android app aggregates daily calories using local timezone day boundaries,
but the backend stores and gap-fills using UTC day boundaries — a timezone mismatch.

## Solution

### Part A: Documentation

- **A1.** Create `docs/features/calories.md` documenting calorie computation, data sources,
  HR-based calculation, gap-fill, and source filtering.
- **A2.** Add "Feature Documentation" section to `README.md` linking to `docs/features/`.

### Part B: Source Separation (`aurboda_gap_fill`)

- **B1.** `packages/api-spec/src/schemas/common.ts`: Add `'aurboda_gap_fill'` to
  `dataSourceSchema`. Add `aurbodaOnlySources` constant.
- **B2.** `apps/backend/src/db/time-series.ts`: `getSourceFilter` returns `aurbodaOnlySources`.
  Add `'aurboda_gap_fill'` to delete `IN` clauses.
- **B3.** `apps/backend/src/db/cumulative-query.ts`: Use `aurbodaOnlySources` instead of
  hardcoded `['aurboda']`.
- **B4.** `apps/backend/src/services/calorie-computation.ts` gap-fill: Write with source
  `'aurboda_gap_fill'`. Delete existing gap-fill before recomputing (idempotent).
- **B5.** HR computation: Delete stale `aurboda_gap_fill` points before inserting HR-computed
  points.
- **B6.** Force-recompute: Also delete `'aurboda_gap_fill'` alongside `'aurboda'`.
- **B7.** Build and regenerate api-spec.

### Part C: Timezone-Aware Daily Aggregates

- **C1.** `packages/api-spec/src/schemas/sync.ts`: Add optional `timezone` field to
  `dailyAggregateSchema`.
- **C2.** `apps/android/.../DailyAggregateSync.kt`: Send `timezone = ZoneId.systemDefault().id`.
- **C3.** `apps/backend/src/db/health-connect.ts` `processDailyAggregate`: When timezone
  provided, store at local midnight converted to UTC. Store timezone in user settings.
- **C4.** Gap-fill: Use timezone from user settings for day boundaries.

### Part E: Tests

- Update calorie computation tests for new source.
- Test timezone handling in processDailyAggregate.
- `pnpm fix && pnpm check`.

### Post-deploy

- Run `recalculate_calories` via MCP.
- Add goal: `{ metric: 'calories_active', min: 4200, window: '7d' }`.

### Deferred / Known Limitations

- **Goals may undercount calories_active** if HR sum exceeds HC aggregate (rare in practice).
- **Per-source calorie trust** — future setting for devices like Withings Scanwatch 2.
