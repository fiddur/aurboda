import { breakdownFieldLabel, PEOPLE_BREAKDOWN_FIELD } from '@aurboda/api-spec'

import type { ActivityTypeDefinition } from '../../state/api'

import { categoricalFields } from '../../components/sessions/sessionView'
import { itemBreakdownOptions, type MeasureState } from './chartMeasures'

/**
 * With (who the activity was with) when the account has people or the chart already breaks down by
 * them, then the scalar categorical fields, then the measure's item breakdowns (per exercise, per
 * muscle group) when charting a measure.
 */
export const breakdownOptions = (
  typeDef: Pick<ActivityTypeDefinition, 'data_schema'> | undefined,
  state: MeasureState & { breakdown_fields: string[] },
  hasPeople: boolean,
): { label: string; name: string }[] => {
  const people =
    hasPeople || state.breakdown_fields.includes(PEOPLE_BREAKDOWN_FIELD)
      ? [{ label: breakdownFieldLabel(PEOPLE_BREAKDOWN_FIELD), name: PEOPLE_BREAKDOWN_FIELD }]
      : []
  const scalar = categoricalFields(typeDef?.data_schema).map((f) => ({
    label: f.label ?? f.name,
    name: f.name,
  }))
  return [...people, ...scalar, ...itemBreakdownOptions(typeDef?.data_schema, state.measure, state)]
}
