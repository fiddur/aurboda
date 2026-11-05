/**
 * Native card for an exercise-share post: the records, the one chart and the last sessions, drawn
 * from the structured payload. The owner's feed, the public profile and a peer's timeline all render
 * it, so the note goes through `renderRemoteMarkdown` everywhere.
 */
import type { ExerciseShare, FeedStructuredExerciseShare } from '@aurboda/api-spec'

import { exerciseChartTitle } from '../../components/charts/exercise-chart'
import { ExerciseChart } from '../../components/charts/ExerciseChart'
import { httpLink } from '../../utils/http-link'
import { renderRemoteMarkdown } from '../../utils/markdown'
import { DoneCard, RecordCard } from '../ActivityTypeItem/ItemCards'
import { ItemSessionsTable } from '../ActivityTypeItem/ItemSessionsTable'
import '../ActivityTypeItem/style.css'
import './FeedPostCard.css'
import './TimelineStructured.css'
import './ExerciseShareContent.css'

const ExerciseTitle = ({ name, url }: { name: string; url?: string }) => {
  const link = httpLink(url)
  return (
    <p class="feed-post-title">
      <strong>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {name}
          </a>
        ) : (
          name
        )}
      </strong>
    </p>
  )
}

const Message = ({ message }: { message?: string | null }) =>
  message ? <div dangerouslySetInnerHTML={{ __html: renderRemoteMarkdown(message) }} /> : null

export const ExerciseShareContent = ({ structured }: { structured: FeedStructuredExerciseShare }) => {
  const { data } = structured
  const chartTitle = exerciseChartTitle(data.per_week, data.trend)

  return (
    <div class="timeline-structured timeline-exercise-share">
      <ExerciseTitle name={structured.name} url={structured.url} />
      <p class="timeline-exercise-share-type">{structured.activity_type_name}</p>
      <Message message={structured.message} />
      {(data.records.length > 0 || data.done) && (
        <div class="activity-type-item-cards">
          {data.records.map((r) => (
            <RecordCard key={r.measure} record={r} />
          ))}
          {data.done && <DoneCard done={data.done} />}
        </div>
      )}
      {chartTitle && (
        <div class="timeline-chart">
          <div class="timeline-exercise-share-chart-title">{chartTitle}</div>
          <ExerciseChart perWeek={data.per_week} trend={data.trend} height={200} />
        </div>
      )}
      {data.history.length > 0 && (
        <>
          <p class="timeline-exercise-share-heading">Last sessions</p>
          <ItemSessionsTable sessions={data.history} />
        </>
      )}
    </div>
  )
}

/** An exercise post whose payload could not be resolved: the exercise has no sessions any more. */
export const ExerciseShareFallback = ({
  exercise,
  message,
}: {
  exercise: ExerciseShare
  message?: string | null
}) => (
  <div class="timeline-structured timeline-exercise-share">
    <ExerciseTitle name={exercise.name} url={exercise.url} />
    <Message message={message} />
    <p class="timeline-exercise-share-type">No sessions with this exercise any more.</p>
  </div>
)
