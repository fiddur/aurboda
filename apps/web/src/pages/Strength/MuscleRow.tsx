import { recoveryLevel, sourceLabel } from '../../components/muscleRecovery/recoveryView'
import { muscleGroupHref } from '../../components/sessions/sessionView'
import { formatSetCount } from '../../utils/measures'
import { lastTrainedLabel } from '../MuscleGroup/muscleGroupView'
import { GroupLifts } from '../StrengthScore/GroupSection'
import { changeLabel, pointsLabel } from '../StrengthScore/strengthScoreView'
import { detailUrl, SETS_PATH, STRENGTH_TYPE } from './constants'
import {
  isNeglected,
  isReady,
  type MuscleRow as Row,
  newestSource,
  recoveryText,
  scoredAsOneNote,
  scoreLine,
  SET_WINDOWS,
  setsText,
  shortReadyLabel,
  unscoredText,
  windowHeights,
  windowsLabel,
} from './musclesModel'

const changeClass = (change: number): string => {
  if (change > 0) return 'strength-muscle-up'
  return change < 0 ? 'strength-muscle-down' : 'strength-muscle-muted'
}

const RecoveryCell = ({ now, readyPercent, row }: { now: Date; readyPercent?: number; row: Row }) => {
  const r = row.recovery
  if (!r || readyPercent === undefined) return <span class="strength-muscle-cell">–</span>
  const short = isReady(r, readyPercent) ? undefined : shortReadyLabel(r.ready_at, now)
  return (
    <span class={`strength-muscle-cell muscle-recovery-${recoveryLevel(r.recovery, readyPercent)}`}>
      <span class={short ? 'strength-muscle-warning' : undefined}>
        {r.recovery} %{short && ` · ${short}`}
      </span>
      <span class="muscle-recovery-bar strength-muscle-bar" aria-hidden="true">
        <span class="muscle-recovery-fill" style={{ width: `${r.recovery}%` }} />
      </span>
    </span>
  )
}

const ScoreCell = ({ row }: { row: Row }) => {
  const points = row.score_group?.score ?? null
  if (points === null) return <span class="strength-muscle-cell">–</span>
  return (
    <span class="strength-muscle-cell">
      <strong>{pointsLabel(points)}</strong>
      {row.score_change !== undefined && (
        <span class={`strength-muscle-sub ${changeClass(row.score_change)}`}>
          {changeLabel(row.score_change)}
        </span>
      )}
    </span>
  )
}

const RecoveryBlock = ({ now, readyPercent, row }: { now: Date; readyPercent: number; row: Row }) => {
  const r = row.recovery
  if (!r) return null
  const source = newestSource(r)
  return (
    <div class="strength-muscle-block">
      <h3>Recovery</h3>
      <p>
        {recoveryText(r, readyPercent, now)}
        {source && (
          <>
            {' '}
            Last worked <a href={detailUrl(source.session_id)}>{sourceLabel(source)}</a>.
          </>
        )}
      </p>
    </div>
  )
}

const SetsBlock = ({ row }: { row: Row }) => {
  const heights = windowHeights(row.windows)
  return (
    <div class="strength-muscle-block">
      <h3>Sets</h3>
      <p>{setsText(row)}</p>
      <div class="strength-muscle-weeks" role="img" aria-label={windowsLabel(row.windows)}>
        {heights.map((h, i) => (
          <span key={i} class="strength-muscle-week">
            <span style={{ height: `${h * 100}%` }} />
          </span>
        ))}
      </div>
      <p class="strength-muted">Sets per week, {SET_WINDOWS} weeks, the last 7 days last</p>
    </div>
  )
}

const ScoreBlock = ({ row }: { row: Row }) => {
  const group = row.score_group
  if (!group) {
    return (
      <div class="strength-muscle-block">
        <h3>Strength score</h3>
        <p>{unscoredText(row.name)}</p>
      </div>
    )
  }
  const line = scoreLine(group, row.score_change)
  const note = scoredAsOneNote(group)
  return (
    <div class="strength-muscle-block">
      <h3>Strength score</h3>
      {line && <p>{line}</p>}
      {note && <p class="strength-muted">{note}</p>}
      <GroupLifts field={SETS_PATH} group={group} name={STRENGTH_TYPE} />
    </div>
  )
}

export const MuscleRow = ({
  now,
  onToggle,
  open,
  readyPercent,
  row,
  scoreLoaded,
}: {
  now: Date
  onToggle: () => void
  open: boolean
  readyPercent?: number
  row: Row
  scoreLoaded: boolean
}) => {
  const detailsId = `strength-muscle-${row.muscle_group}`
  return (
    <li class="strength-muscle">
      <button
        type="button"
        class="strength-muscle-row strength-muscle-grid"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span class="strength-muscle-cell strength-muscle-name">
          <strong>{row.name}</strong>
          <span
            class={`strength-muscle-sub ${isNeglected(row.last_trained, now) ? 'strength-muscle-warning' : 'strength-muscle-muted'}`}
          >
            {lastTrainedLabel(row.last_trained, now, 'short')}
          </span>
        </span>
        <RecoveryCell now={now} readyPercent={readyPercent} row={row} />
        <span class="strength-muscle-cell">
          <strong>{formatSetCount(row.sets7)}</strong>
          <span class="strength-muscle-sub strength-muscle-muted">avg {formatSetCount(row.avg)}</span>
        </span>
        <ScoreCell row={row} />
        <span class="strength-muscle-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <div id={detailsId} class="strength-muscle-details" role="region" aria-label={row.name} hidden={!open}>
        {readyPercent !== undefined && <RecoveryBlock now={now} readyPercent={readyPercent} row={row} />}
        <SetsBlock row={row} />
        {scoreLoaded && <ScoreBlock row={row} />}
        <div class="strength-row-actions">
          <a class="btn-secondary" href={muscleGroupHref(STRENGTH_TYPE, SETS_PATH, row.muscle_group)}>
            {row.name} history
          </a>
          <a
            class="btn-secondary"
            href={`/strength/exercises?muscle=${encodeURIComponent(row.muscle_group)}`}
          >
            Exercises
          </a>
        </div>
      </div>
    </li>
  )
}
