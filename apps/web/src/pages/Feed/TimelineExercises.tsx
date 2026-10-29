import type { FeedStructuredExercise } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'
import { Fragment } from 'preact'

import { exerciseRow } from './timeline-exercises'
import './TimelineExercises.css'

export function TimelineExercises({ exercises }: { exercises: readonly FeedStructuredExercise[] }) {
  if (exercises.length === 0) return null
  return (
    <div class="timeline-exercises">
      <span class="timeline-exercises-heading">Exercises</span>
      <ul>
        {exercises.map((exercise, i) => {
          const row = exerciseRow(exercise)
          return (
            <li key={`${i}-${row.name}`} class="timeline-exercise">
              <div class="timeline-exercise-name">
                <strong>{row.name}</strong>
                {row.badges.map(({ label, measure }) => (
                  <span key={measure} class="timeline-exercise-pr" title={activityMeasureLabels[measure]}>
                    {label}
                  </span>
                ))}
              </div>
              <div class="timeline-exercise-line">
                {row.sets.map((set, j) => (
                  <Fragment key={j}>
                    {j > 0 && ', '}
                    <span class="timeline-exercise-chunk">{set}</span>
                  </Fragment>
                ))}
                {row.summary.map((part) => (
                  <Fragment key={part}>
                    <span class="timeline-exercise-summary"> · </span>
                    <span class="timeline-exercise-chunk timeline-exercise-summary">{part}</span>
                  </Fragment>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
