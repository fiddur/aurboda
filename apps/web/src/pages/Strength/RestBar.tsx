import { formatClock, REST_LENGTHS_S, type RestState } from './restTimer'

export const RestBar = ({
  rest,
  lengthS,
  onLengthChange,
  onExtend,
  onSkip,
}: {
  rest: RestState
  lengthS: number
  onLengthChange: (seconds: number) => void
  onExtend: () => void
  onSkip: () => void
}) => (
  <div class="strength-rest-bar" role="timer" aria-live="off">
    <span class="strength-rest-text">
      Rest <strong>{formatClock(rest.remaining_s)}</strong> of{' '}
      {rest.total_s === lengthS ? (
        <select
          aria-label="Rest length"
          value={String(lengthS)}
          onChange={(e) => onLengthChange(Number((e.target as HTMLSelectElement).value))}
        >
          {REST_LENGTHS_S.map((s) => (
            <option key={s} value={String(s)}>
              {formatClock(s)}
            </option>
          ))}
        </select>
      ) : (
        formatClock(rest.total_s)
      )}
    </span>
    <div class="strength-rest-actions">
      <button type="button" class="btn-secondary" onClick={onExtend}>
        +30 s
      </button>
      <button type="button" class="btn-secondary" onClick={onSkip}>
        Skip
      </button>
    </div>
  </div>
)
