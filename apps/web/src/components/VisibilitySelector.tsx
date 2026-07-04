/**
 * Shared visibility picker for anything shareable — feed posts, shared
 * dashboards, and hosted challenges — so the whole app offers one consistent
 * radio idiom and one vocabulary (`public`/`unlisted`, plus the feed-only
 * `followers`) instead of a mix of checkboxes and bespoke lists.
 *
 * Presentational and generic: the caller passes the option set (labels + hints
 * live in the exported `SHARE_VISIBILITY_OPTIONS` / `FEED_VISIBILITY_OPTIONS`
 * constants — the single source of truth) plus a unique `name` so multiple
 * selectors on one page (e.g. a card per dashboard) don't share a radio group.
 */
import type { FeedVisibility, ShareVisibility } from '@aurboda/api-spec'

import './VisibilitySelector.css'

export interface VisibilityOption<T extends string> {
  value: T
  label: string
  hint: string
}

/** Dashboards + challenges: public (listed on your profile) or unlisted (link-only). */
export const SHARE_VISIBILITY_OPTIONS: VisibilityOption<ShareVisibility>[] = [
  { hint: 'Listed on your public profile; anyone can find it.', label: 'Public', value: 'public' },
  { hint: 'Reachable only by its link; kept off your public profile.', label: 'Unlisted', value: 'unlisted' },
]

/** Feed posts: the shared audiences plus followers-only. */
export const FEED_VISIBILITY_OPTIONS: VisibilityOption<FeedVisibility>[] = [
  { hint: 'Anyone can see it; appears in public timelines.', label: 'Public', value: 'public' },
  { hint: 'Anyone with the link; kept out of public timelines.', label: 'Unlisted', value: 'unlisted' },
  { hint: 'Only your followers.', label: 'Followers only', value: 'followers' },
]

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: VisibilityOption<T>[]
  /** Unique radio-group name — required when more than one selector can render on a page. */
  name: string
  legend?: string
  /** Inline, labels-only layout for dense list rows (drops the per-option hints). */
  compact?: boolean
}

export function VisibilitySelector<T extends string>({
  value,
  onChange,
  options,
  name,
  legend = 'Visibility',
  compact = false,
}: Props<T>) {
  return (
    <fieldset class={compact ? 'visibility-selector compact' : 'visibility-selector'}>
      <legend>{legend}</legend>
      {options.map((opt) => (
        <label key={opt.value} class="visibility-option">
          <input
            type="radio"
            name={name}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span>
            <strong>{opt.label}</strong>
            {!compact && <span class="visibility-hint">{opt.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}
