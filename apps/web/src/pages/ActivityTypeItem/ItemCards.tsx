import { formatDay } from '../../components/RecordCard'

export const DoneCard = ({ done }: { done: { count: number; first: string; last: string } }) => (
  <div class="activity-type-item-card">
    <div class="activity-type-item-card-label">Done</div>
    <div class="activity-type-item-card-value">{done.count}×</div>
    <div class="activity-type-item-card-detail">
      {done.count === 1 ? formatDay(done.first) : `${formatDay(done.first)} – ${formatDay(done.last)}`}
    </div>
  </div>
)
