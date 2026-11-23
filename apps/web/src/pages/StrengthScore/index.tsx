import type { StrengthScore as Score, StrengthScoreGroup, StrengthScoreMissing } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import { fetchActivityTypeDefinitions } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { unmappedSectionId } from '../ActivityTypeMeta/UnmappedItemValuesSection'
import { GroupSection } from './GroupSection'
import { useStrengthScore, useStrengthScoreHistory } from './queries'
import { ScoreHistory } from './ScoreHistory'
import {
  averageLabel,
  changeLabel,
  missingText,
  pointsLabel,
  scoreChange,
  STRENGTH_SCORE_PERIODS,
  strongestAndWeakest,
  strongestAndWeakestLabel,
} from './strengthScoreView'
import '../ActivityTypeItem/style.css'
import './style.css'

const FIVE_MIN = 5 * 60 * 1000
const CHANGE_DAYS = 30

const CAPTION =
  "A lift's points compare your best estimated one-rep max of the last 90 days (working sets with a weight; reps above 12 count as 12) with a reference for your sex and bodyweight; 100 is a solid recreational lifter. A muscle group is the average of its best three lifts, the score the average of the groups. Dumbbell lifts count per dumbbell, as logged. Only exercises matched to the catalogue count:"

const MissingNotice = ({ missing }: { missing: StrengthScoreMissing[] }) => {
  const text = missingText(missing)
  if (!text) return null
  return (
    <div class="strength-score-notice">
      <p>{text.sentence}</p>
      <p>
        {text.actions.map((a, i) => (
          <span key={a.href}>
            {i > 0 && ' '}
            {a.before}
            <a href={a.href}>{a.link}</a>
            {a.after}
          </span>
        ))}
      </p>
    </div>
  )
}

const ScoreCards = ({ field, name, score }: { field: string; name: string; score: Score }) => {
  const history = useStrengthScoreHistory(name, field, STRENGTH_SCORE_PERIODS[0].value)
  const change = scoreChange(history.data, CHANGE_DAYS)
  const extremes = strongestAndWeakest(score)
  return (
    <div class="activity-type-item-cards">
      <div class="activity-type-item-card">
        <div class="activity-type-item-card-label">Strength score</div>
        <div class="activity-type-item-card-value">{pointsLabel(score.score)}</div>
        <div class="activity-type-item-card-detail">{averageLabel(score)}</div>
      </div>
      {change !== undefined && (
        <div class="activity-type-item-card">
          <div class="activity-type-item-card-label">Last 30 days</div>
          <div class="activity-type-item-card-value">{changeLabel(change)}</div>
        </div>
      )}
      {extremes && (
        <div class="activity-type-item-card">
          <div class="activity-type-item-card-label">Strongest and weakest</div>
          <div class="activity-type-item-card-value">
            {strongestAndWeakestLabel(extremes).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const Body = ({ field, name, score }: { field: string; name: string; score: Score }) => {
  const groupNames: Partial<Record<StrengthScoreGroup, string>> = Object.fromEntries(
    score.groups.map((g) => [g.group, g.name]),
  )
  return (
    <>
      <MissingNotice missing={score.missing} />
      {score.missing.length === 0 && (
        <>
          <ScoreCards field={field} name={name} score={score} />
          <ScoreHistory field={field} groupNames={groupNames} name={name} />
        </>
      )}
      {score.groups.map((g) => (
        <GroupSection key={g.group} field={field} group={g} name={name} />
      ))}
      <p class="activity-type-item-caption">
        {CAPTION}{' '}
        <a href={`/activity-type/${encodeURIComponent(name)}#${unmappedSectionId(field)}`}>
          see the unmatched ones
        </a>
      </p>
    </>
  )
}

export function StrengthScoreContent({ field, name }: { field: string; name: string }) {
  const query = useStrengthScore(name, field)
  return (
    <>
      {query.isLoading && <p class="loading">Loading...</p>}
      {(query.isError || (query.isSuccess && !query.data)) && (
        <p class="strength-score-retry">
          The strength score could not be loaded just now.{' '}
          <button
            type="button"
            class="btn-secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Trying…' : 'Try again'}
          </button>
        </p>
      )}
      {query.data && <Body field={field} name={name} score={query.data} />}
    </>
  )
}

/** The strength score of a type: overall, over time, and per muscle group the lifts behind it. */
export function StrengthScore() {
  const { params } = useRoute()
  const name = params.name as string
  const field = params.field as string

  const { data: definitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: FIVE_MIN,
  })
  const typeName = definitions?.find((d) => d.name === name)?.display_name ?? toDisplayName(name)

  return (
    <div class="page page--full activity-type-item-page">
      <a href={`/activity-type/${encodeURIComponent(name)}`} class="activity-type-item-back">
        ← {typeName}
      </a>
      <header class="activity-type-item-header">
        <h1>Strength score</h1>
        <p class="activity-type-item-subtitle">{typeName} · best lifts of the last 90 days</p>
      </header>
      <StrengthScoreContent field={field} name={name} />
    </div>
  )
}
