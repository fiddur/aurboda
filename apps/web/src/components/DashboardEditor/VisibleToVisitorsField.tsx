import './VisibleToVisitorsField.css'

export const DAY_OVERVIEW_VISITOR_WARNING =
  'Visitors of this dashboard see the whole day hour by hour: the two metrics in 5-minute steps, when you slept and napped, and the name and start time of every activity.'

export const RECENT_ACTIVITIES_VISITOR_WARNING =
  "Visitors of this dashboard see each listed activity's name, start time and duration, and its distance, sets, average heart rate and calories where it has them."

export const VisibleToVisitorsField = ({
  checked,
  onChange,
  warning,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  warning: string
}) => (
  <div class="form-group visible-to-visitors">
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />{' '}
      Show to visitors
    </label>
    <p class="form-warning">
      {warning}
      {!checked && ' Off: only you see this card.'}
    </p>
  </div>
)
