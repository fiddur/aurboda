import {
  type ActivityMeasure,
  activityMeasureUnits,
  type ChallengeAggregation,
  type ChallengeBucketSizeChoice,
  type ChallengeSourceType,
  type ChallengeSpec,
  measureDefaultAggregation,
} from '@aurboda/api-spec'

export interface SpecForm {
  aggregation: ChallengeAggregation
  filter_field?: string
  filter_value?: string
  measure?: ActivityMeasure
  pattern: string
  source_type: ChallengeSourceType
  unit: string
}

export type SpecChange =
  | { kind: 'filter'; path: string; value: string }
  | { kind: 'measure'; measure: ActivityMeasure | undefined }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'source_type'; source_type: ChallengeSourceType }

export const emptySpecForm: SpecForm = { aggregation: 'sum', pattern: '', source_type: 'metric', unit: '' }

/** `set_count` has no unit of its own, and a challenge needs one. */
export const defaultUnit = (measure: ActivityMeasure): string =>
  measure === 'set_count' ? 'sets' : activityMeasureUnits[measure]

export const aggregationOptions = (
  measure: ActivityMeasure | undefined,
): { label: string; value: ChallengeAggregation }[] =>
  measure
    ? [
        { label: 'Sum', value: 'sum' },
        { label: 'Max (best single session)', value: 'max' },
      ]
    : [
        { label: 'Sum', value: 'sum' },
        { label: 'Count', value: 'count' },
      ]

/** Whether the unit is one the form filled in for the current measure rather than one the user typed. */
const unitIsFilledIn = (form: SpecForm): boolean =>
  form.unit === '' || (form.measure !== undefined && form.unit === defaultUnit(form.measure))

const noFilter = { filter_field: undefined, filter_value: undefined }

const withoutMeasure = (form: SpecForm): Partial<SpecForm> =>
  form.measure === undefined
    ? noFilter
    : {
        ...noFilter,
        aggregation: 'sum',
        measure: undefined,
        ...(unitIsFilledIn(form) ? { unit: '' } : {}),
      }

export const specPatch = (form: SpecForm, change: SpecChange): Partial<SpecForm> => {
  switch (change.kind) {
    case 'source_type':
      return { ...withoutMeasure(form), pattern: '', source_type: change.source_type }
    case 'pattern':
      return change.pattern === form.pattern ? {} : { ...withoutMeasure(form), pattern: change.pattern }
    case 'measure':
      return change.measure === undefined
        ? withoutMeasure(form)
        : {
            ...noFilter,
            aggregation: measureDefaultAggregation(change.measure),
            measure: change.measure,
            ...(unitIsFilledIn(form) ? { unit: defaultUnit(change.measure) } : {}),
          }
    case 'filter':
      return change.value ? { filter_field: change.path, filter_value: change.value } : noFilter
  }
}

export const buildSpec = (form: SpecForm, bucket_size: ChallengeBucketSizeChoice): ChallengeSpec => ({
  aggregation: form.aggregation,
  bucket_size,
  pattern: form.pattern.trim(),
  source_type: form.source_type,
  unit: form.unit.trim(),
  ...(form.measure ? { measure: form.measure } : {}),
  ...(form.measure && form.filter_field && form.filter_value
    ? { filter_field: form.filter_field, filter_value: form.filter_value }
    : {}),
})
