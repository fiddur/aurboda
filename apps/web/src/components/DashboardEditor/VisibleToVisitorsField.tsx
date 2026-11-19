import './VisibleToVisitorsField.css'

export const DAY_OVERVIEW_VISITOR_WARNING =
  'Visitors of this dashboard see the whole day hour by hour: the two metrics in 5-minute steps, when you slept and napped, and the name and start time of every activity.'

export const VisibleToVisitorsField = ({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
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
      {DAY_OVERVIEW_VISITOR_WARNING}
      {!checked && ' Off: only you see this card.'}
    </p>
  </div>
)
