import {
  type ActivityMeasure,
  exerciseMuscleInfo,
  measureGoalTitle,
  muscleGroupFilter,
} from '@aurboda/api-spec'

import { tagList } from '../../pages/Journal/journal-list'
import { toDisplayName } from '../../utils/displayName'

interface ChartSource {
  filter_field?: string
  filter_value?: string
  measure?: ActivityMeasure
  pattern?: string
  source_type: string
}

/** What a chart's filter reads as: the exercise, or a muscle group's display name. */
export const filterSubject = (filter_field?: string, filter_value?: string): string | undefined => {
  const muscle = muscleGroupFilter(filter_field, filter_value)
  return muscle ? exerciseMuscleInfo[muscle.group].name : filter_value
}

/** `Bench Press · Best e1RM` or `Chest · Sets` for an activity-measure chart; undefined for any other source. */
export const measureChartTitle = ({
  filter_field,
  filter_value,
  measure,
  pattern,
  source_type,
}: ChartSource): string | undefined => {
  if (source_type !== 'activity_type' || (measure === undefined && filter_value === undefined)) {
    return undefined
  }
  const typeName = pattern ? toDisplayName(pattern) : undefined
  const subject = filterSubject(filter_field, filter_value)
  return measure ? measureGoalTitle(measure, subject, typeName) : (subject ?? typeName)
}

interface JournalTitleSource {
  aggregation?: string
  journal_tags?: string
  source_type: string
}

/** `Journal entries` or `Journal words`, then ` · #travel #work` when filtered by tags; undefined for any other source. */
export const journalChartTitle = ({
  aggregation,
  journal_tags,
  source_type,
}: JournalTitleSource): string | undefined => {
  if (source_type !== 'journal') return undefined
  const base = aggregation === 'sum' ? 'Journal words' : 'Journal entries'
  const tags = tagList(journal_tags)
  return tags.length > 0 ? `${base} · ${tags.map((tag) => `#${tag}`).join(' ')}` : base
}
