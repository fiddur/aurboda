import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { fetchActivityById, fetchMeal, fetchNoteTags, fetchReport, JOURNAL_KEY } from '../../state/api'
import { tagOptions } from './journal-tags'
import { RelatedTabs, usePeople } from './Related'
import {
  activityLabel,
  mealLabel,
  type RelatedFilter,
  relatedFilterLabel,
  relatedFilterLinks,
  type RelatedLink,
  reportLabel,
} from './related'
import './style.css'

export { JOURNAL_KEY }

export const JOURNAL_TAGS_KEY = [...JOURNAL_KEY, 'tags'] as const

export const useDebounced = <T,>(value: T, ms: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export const RelatedToButton = ({
  related,
  open,
  onToggle,
  onClear,
}: {
  related: RelatedFilter | undefined
  open: boolean
  onToggle: () => void
  onClear: () => void
}) => {
  const people = usePeople()
  const activity = useQuery({
    enabled: related?.type === 'activity',
    queryFn: () => fetchActivityById(related!.id),
    queryKey: ['journal-related-activity', related?.id],
  })
  const meal = useQuery({
    enabled: related?.type === 'meal',
    queryFn: () => fetchMeal(related!.id),
    queryKey: ['journal-related-meal', related?.id],
  })
  const report = useQuery({
    enabled: related?.type === 'report',
    queryFn: () => fetchReport(related!.id),
    queryKey: ['journal-related-report', related?.id],
  })
  const targetLabel = (): string | undefined => {
    if (related?.type === 'activity' && activity.data) return activityLabel(activity.data.activity)
    if (related?.type === 'meal' && meal.data) return mealLabel(meal.data)
    if (related?.type === 'report' && report.data) return reportLabel(report.data)
    return undefined
  }
  const label = relatedFilterLabel(related, people.data?.people ?? [], targetLabel())
  return (
    <span class="journal-related-filter">
      <span>Related to</span>
      <button type="button" class="btn-secondary journal-related-add" aria-expanded={open} onClick={onToggle}>
        {label}
      </button>
      {related && (
        <button type="button" class="journal-link-btn" onClick={onClear}>
          Clear
        </button>
      )}
    </span>
  )
}

/** "Related to": a person, a report, or an activity, meal or check-in of any day, picked from a tab per kind. */
export const RelatedToPicker = ({
  related,
  today,
  onPick,
}: {
  related: RelatedFilter | undefined
  today: string
  onPick: (related: RelatedFilter) => void
}) => {
  const links = relatedFilterLinks(related, '')
  const take = (link: RelatedLink) => onPick({ id: link.entity_id, type: link.entity_type })
  return (
    <div class="journal-card journal-related-picker" aria-label="Related to">
      <RelatedTabs
        entryDate={today}
        links={links}
        onAdd={take}
        initial={related?.type}
        allowNewPerson={false}
      />
    </div>
  )
}

/** The tags to filter on, most used first, leaving out those already in the filter. */
export const TagsPicker = ({
  active,
  onPick,
}: {
  active: readonly string[]
  onPick: (tag: string) => void
}) => {
  const [search, setSearch] = useState('')
  const tags = useQuery({ queryFn: () => fetchNoteTags(), queryKey: JOURNAL_TAGS_KEY })
  const shown = tagOptions(tags.data ?? [], search, active)
  return (
    <div class="journal-card journal-related-picker journal-related-options" aria-label="Tags">
      <input
        type="search"
        placeholder="Search tags"
        aria-label="Search tags"
        value={search}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      {tags.isLoading && <p class="journal-muted">Loading…</p>}
      {tags.isError && <p class="journal-error">The tags could not be loaded.</p>}
      {tags.isSuccess && shown.length === 0 && (
        <p class="journal-muted">{(tags.data ?? []).length === 0 ? 'No tags yet.' : 'No tag matches.'}</p>
      )}
      <ul>
        {shown.map((tag) => (
          <li key={tag.tag}>
            <button type="button" class="journal-related-option" onClick={() => onPick(tag.tag)}>
              <strong>#{tag.tag}</strong>
              <span class="journal-muted"> · {tag.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <a class="journal-link-btn" href="/journal/tags">
        Manage tags
      </a>
    </div>
  )
}

export const ActiveTags = ({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) =>
  tags.length > 0 ? (
    <div class="journal-active-tags" aria-label="Showing entries tagged">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          class="journal-chip active"
          onClick={() => onChange(tags.filter((t) => t !== tag))}
          aria-label={`Stop filtering by #${tag}`}
        >
          #{tag} ✕
        </button>
      ))}
    </div>
  ) : null
