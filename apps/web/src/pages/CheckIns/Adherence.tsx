import type { CheckInForm } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchCheckInAdherence } from '../../state/api'
import { checkInKeys } from './queries'
import { adherenceCells, hasSlots, itemCounts } from './routines'

const LEGEND = [
  { label: 'Done', state: 'done' },
  { label: 'Skipped', state: 'skipped' },
  { label: 'Missed', state: 'missed' },
] as const

export function Adherence({ form }: { form: CheckInForm }) {
  const { data } = useQuery({
    queryFn: () => fetchCheckInAdherence(form.id),
    queryKey: checkInKeys.adherence(form.id),
  })
  if (!data) return null
  const slotted = hasSlots(data)
  if (!slotted && data.answered_check_ins === 0) return null
  const cells = adherenceCells(data.days)
  const items = itemCounts(data)
  return (
    <section class="checkins-section checkin-adherence">
      <h2>Last {data.days.length} days</h2>
      <div class="checkins-card">
        {slotted && (
          <>
            <ul class="checkin-adherence-legend">
              {LEGEND.map(({ label, state }) => (
                <li key={state}>
                  <span class={`checkin-adherence-swatch state-${state}`} aria-hidden="true" />
                  {label} <strong>{data.totals[state]}</strong>
                </li>
              ))}
            </ul>
            <div class="checkin-adherence-strip" role="list" aria-label="Slots per day">
              {cells.map((cell) => (
                <div
                  key={cell.date}
                  class="checkin-adherence-day"
                  role="listitem"
                  title={cell.label}
                  aria-label={cell.label}
                >
                  {cell.slots.length === 0 ? (
                    <span class="checkin-adherence-slot state-none" />
                  ) : (
                    cell.slots.map((state, index) => (
                      <span key={index} class={`checkin-adherence-slot state-${state}`} />
                    ))
                  )}
                </div>
              ))}
            </div>
            <div class="checkin-adherence-axis" aria-hidden="true">
              <span>{data.from}</span>
              <span>{data.to}</span>
            </div>
          </>
        )}
        {items.length > 0 && data.answered_check_ins > 0 && (
          <>
            <p class="checkin-adherence-items-title">
              {form.is_routine ? 'How often each item was taken' : 'How often each question was answered'}{' '}
              <span class="checkins-muted">({data.answered_check_ins} check-ins)</span>
            </p>
            <ul class="checkin-adherence-items">
              {items.map((item) => (
                <li key={item.key}>
                  <span class="checkin-adherence-item-name">{item.prompt}</span>
                  <span class="checkin-adherence-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(item.share * 100)}%` }} />
                  </span>
                  <span class="checkin-adherence-item-count">{item.line}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
