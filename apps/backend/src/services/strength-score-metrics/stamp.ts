import type { StrengthScoreInputAggregates } from '../../db/index.ts'

/** Bump whenever the rule for the stored values changes, so every user is recalculated once. */
export const STRENGTH_SCORE_METRICS_VERSION = 1

export interface StrengthScoreStampInputs {
  activity_types: readonly string[]
  aggregates: StrengthScoreInputAggregates
  catalog_version: string
  references_version: number
  sex: string | null
  timezone: string
  today: string
}

/** A stable string that changes whenever anything the stored strength score metrics follow from changes. */
export const strengthScoreStamp = (inputs: StrengthScoreStampInputs): string =>
  JSON.stringify([
    STRENGTH_SCORE_METRICS_VERSION,
    inputs.references_version,
    inputs.catalog_version,
    inputs.timezone,
    inputs.sex,
    inputs.today,
    inputs.activity_types.toSorted(),
    inputs.aggregates.activities,
    inputs.aggregates.weight,
    inputs.aggregates.item_value_identities,
    inputs.aggregates.item_value_aliases,
    inputs.aggregates.shared_exercises,
  ])
