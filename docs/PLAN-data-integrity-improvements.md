# Plan (maybe/future): Data-Integrity Improvements

Status: **idea backlog — not scheduled**. Captured 2026-08 from a discussion of a
[r/QuantifiedSelf post](https://www.reddit.com/r/QuantifiedSelf/comments/1v8siau/)
by another wearable-aggregation developer, filtered down to what actually applies
to Aurboda. Items are independent; pick any one up on its own.

## Already covered (checked, no action)

- **Cross-source activity dedup** — `apps/backend/src/db/activities/merge.ts`
  merges on start-time proximity (120 s) with an explicit source-priority ladder.
- **Health Connect double-counting** — Health Connect's built-in dedup is used
  (see `docs/health-connect.md`).
- **Semantic field traps** — Oura temperature is stored as `temperature_deviation`
  (not mislabeled absolute skin temp); Garmin Body Battery is kept as a full time
  series.
- **Provenance** — `raw_records` preserves originals; rows carry `source`.
- **Fitbit Web API deprecation (reportedly Sept 2026)** — Aurboda gets Fitbit data
  via Health Connect, not `api.fitbit.com`; verify the claim if a direct
  integration is ever planned.

## 1. Multiple-comparison correction in correlations (highest value)

`apps/backend/src/services/correlations/` reports honest per-test statistics
(Welch t, Mann-Whitney, Cohen's d, p-values, CIs, small-n cautions) but no
correction across hypotheses. Any Explore session trying several triggers against
one outcome is a multiple-hypothesis scan; the post's Monte Carlo run put the
naive false-discovery rate at ~27 % of no-effect users vs ~1.7 % with gates.

Possible shape:

- Soft version: an FDR-adjusted p (Benjamini–Hochberg) or a banner — "you have
  tested N hypotheses; expect ~N × 0.05 false positives at p < 0.05".
- Hard version (the post's gates, tune to taste): minimum paired days (~20),
  minimum group sizes (~8 each), effect-size floor, Cohen's d ≥ 0.8, Bonferroni
  across the hypotheses tested in the session/scan.
- Applies doubly to any future "scan everything for correlations" feature.

## 2. Label the impulse basis in training load ("goes dark, doesn't guess")

`apps/backend/src/services/training-load/banister.ts` silently falls back from
HR-based TRIMP to `calories × DEFAULT_ACTIVITY_IMPULSE_SCALE` when HR is missing —
a modelled value mixed indistinguishably into CTL/ATL/TSB next to measured ones.

Possible shape:

- Tag each workout's impulse with its basis (`hr` vs `calorie-estimate`).
- Surface coverage on the response: "this CTL is 40 % estimated".
- Generalize: derived metrics (daily summary, baselines) return a status +
  what's missing instead of a silently thinner number.

## 3. Ingest plausibility gates

Health Connect accepts writes from _any_ app on the phone, so one bad app can
pollute baselines and correlations. The post rejects stage data claiming > 35 %
deep sleep (not physiological) and caught providers writing composite 0–100
wellness scores into the `sleep_efficiency` field (AASM: TST / TIB).

Possible shape: a small validation layer at ingest for sleep stages / efficiency /
HRV outliers — flag or reject, but always keep the `raw_record`.

## 4. Version-stamp derived rows

Training-load recompute, calorie computation, and deduction rules all have
tunable constants. If a constant changes, previously computed rows silently mix
old and new maths. The post stamps every derived row with a contract version and
deletes + recomputes on bump, so a series is always one estimator.

Possible shape: a computation-version stamp on derived rows plus a recompute
trigger on bump — the `recalculate_calories` / training-load `recompute`
machinery already exists, so this is mostly a stamp + trigger.

## 5. Store measured-vs-modelled as data, not a UI label

If the estimated/measured distinction lives only in the interface, exports and
MCP responses lose it, and downstream readers (including LLMs querying via MCP)
treat estimates as measurements.

Possible shape: an `origin` / `is_estimated` field on relevant rows — computed
calories vs logged, provider-native scores (Oura readiness) vs Aurboda-derived
ones — carried through API, MCP, and any future export.

## 6. Personalized two-process energy curve (feature idea, larger scope)

Circadian + homeostatic pressure (Borbély two-process model) fitted to the
user's own data: sleep window from a circular median of actual wake times
(weekday-aware, with confidence + manual override), post-exercise dips scaled by
load, and a what-if planner against a hypothetical bedtime or session. Would fit
the Analyze section; a project rather than a fix.
