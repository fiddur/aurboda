import { useEffect, useState } from 'preact/hooks'

import type { JournalState } from './journalSource'

import { ActiveTags, RelatedToButton, RelatedToPicker, TagsPicker, useDebounced } from '../Journal/filters'
import { localToday } from '../Journal/journal-list'

export type JournalPicker = 'related' | 'tags' | undefined

interface JournalControlsProps {
  state: JournalState
  picker: JournalPicker
  onPicker: (picker: JournalPicker) => void
  onUpdate: (patch: Partial<JournalState>) => void
}

/** The journal source's filters in the source row: Related to, Tags, a text search and the comments switch. */
export function JournalFilterControls({ state, picker, onPicker, onUpdate }: JournalControlsProps) {
  const [draft, setDraft] = useState(state.journal_q)
  const q = useDebounced(draft, 350)
  useEffect(() => {
    if (q !== state.journal_q) onUpdate({ journal_q: q })
  }, [q, state.journal_q, onUpdate])
  const toggle = (which: Exclude<JournalPicker, undefined>) => onPicker(picker === which ? undefined : which)

  return (
    <>
      <div class="chart-journal-filters">
        <RelatedToButton
          related={state.journal_related}
          open={picker === 'related'}
          onToggle={() => toggle('related')}
          onClear={() => {
            onUpdate({ journal_related: undefined })
            onPicker(undefined)
          }}
        />
        <button
          type="button"
          class="btn-secondary journal-related-add"
          aria-expanded={picker === 'tags'}
          onClick={() => toggle('tags')}
        >
          Tags
        </button>
      </div>
      <label>
        Search text
        <input
          type="search"
          value={draft}
          placeholder="Words in the entries"
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
      </label>
      <label class="breakdown-checkbox chart-scatter-collapse">
        <input
          type="checkbox"
          checked={state.journal_comments}
          onChange={(e) => onUpdate({ journal_comments: e.currentTarget.checked, journal_entity_types: '' })}
        />
        Also count comments on activities, meals and reports
      </label>
    </>
  )
}

/** The open picker of the journal filters, and the tags filtered on, under the controls. */
export function JournalFilterPickers({ state, picker, onPicker, onUpdate }: JournalControlsProps) {
  return (
    <div class="chart-journal-pickers">
      {picker === 'related' && (
        <RelatedToPicker
          related={state.journal_related}
          today={localToday()}
          onPick={(journal_related) => {
            onUpdate({ journal_related })
            onPicker(undefined)
          }}
        />
      )}
      {picker === 'tags' && (
        <TagsPicker
          active={state.journal_tags}
          onPick={(tag) => {
            onUpdate({ journal_tags: [...state.journal_tags, tag] })
            onPicker(undefined)
          }}
        />
      )}
      <ActiveTags tags={state.journal_tags} onChange={(journal_tags) => onUpdate({ journal_tags })} />
    </div>
  )
}
