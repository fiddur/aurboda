import type { MergeNoteTagsResult, NoteTagSummary } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { useDebounced } from '../../components/useDebounced'
import { fetchNoteTags, mergeNoteTags } from '../../state/api'
import {
  entriesLabel,
  lastUsedLabel,
  mergeButtonLabel,
  mergedLabel,
  mergeTargetTag,
  tagFilterHref,
  tagOptions,
} from './journal-tags'
import { JOURNAL_KEY, JOURNAL_TAGS_KEY } from './JournalList'

const MERGE_PREVIEW_DEBOUNCE_MS = 300

const MergeForm = ({
  from,
  tags,
  onMerged,
}: {
  from: NoteTagSummary
  tags: readonly NoteTagSummary[]
  onMerged: (result: MergeNoteTagsResult) => void
}) => {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const into = mergeTargetTag(typed)
  const previewed = useDebounced(into, MERGE_PREVIEW_DEBOUNCE_MS)
  const merge = useMutation({
    mutationFn: (target: string) => mergeNoteTags([from.tag], target),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
      onMerged(result)
    },
  })
  const listId = `journal-merge-${from.tag}`
  const valid = into !== null && into !== from.tag
  const preview = useQuery({
    enabled: valid && previewed === into,
    gcTime: 0,
    queryFn: () => mergeNoteTags([from.tag], previewed ?? '', true),
    queryKey: [...JOURNAL_TAGS_KEY, 'merge-preview', from.tag, previewed],
    retry: false,
  })
  const counting = previewed !== into || preview.isFetching
  return (
    <form
      class="journal-tag-merge"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !merge.isPending && !counting) merge.mutate(into)
      }}
    >
      <input
        type="text"
        list={listId}
        placeholder="Tag to merge into"
        aria-label={`Merge #${from.tag} into`}
        value={typed}
        onInput={(e) => {
          setTyped(e.currentTarget.value)
          merge.reset()
        }}
      />
      <datalist id={listId}>
        {tags
          .filter((t) => t.tag !== from.tag)
          .map((t) => (
            <option key={t.tag} value={t.tag} />
          ))}
      </datalist>
      <button type="submit" class="btn-primary" disabled={!valid || merge.isPending || counting}>
        {valid ? mergeButtonLabel(from.tag, into, counting ? undefined : preview.data?.changed) : 'Merge'}
      </button>
      {typed.trim() && into === null && <p class="journal-error">Not a tag: letters, digits and _.</p>}
      {merge.isError && (
        <p class="journal-error" role="alert">
          The tags could not be merged. Please try again.
        </p>
      )}
    </form>
  )
}

const TagRow = ({
  tag,
  tags,
  merging,
  onMergeToggle,
  onMerged,
}: {
  tag: NoteTagSummary
  tags: readonly NoteTagSummary[]
  merging: boolean
  onMergeToggle: () => void
  onMerged: (result: MergeNoteTagsResult) => void
}) => (
  <li>
    <div class="journal-tag-row">
      <a class="journal-chip" href={tagFilterHref(tag.tag)} title={`Show #${tag.tag}`}>
        #{tag.tag}
      </a>
      <span class="journal-muted">
        {entriesLabel(tag.count)} · {lastUsedLabel(tag.last_used)}
      </span>
      <button type="button" class="journal-link-btn" aria-expanded={merging} onClick={onMergeToggle}>
        {merging ? 'Cancel' : 'Merge into…'}
      </button>
    </div>
    {merging && <MergeForm from={tag} tags={tags} onMerged={onMerged} />}
  </li>
)

/** `/journal/tags`: every tag with its count and last use, opening the journal on it, and merging one into another. */
export const JournalTags = () => {
  const [search, setSearch] = useState('')
  const [merging, setMerging] = useState<string>()
  const [merged, setMerged] = useState<MergeNoteTagsResult>()
  const tags = useQuery({ queryFn: () => fetchNoteTags(), queryKey: JOURNAL_TAGS_KEY })
  const all = tags.data ?? []
  const shown = tagOptions(all, search)
  return (
    <div class="page journal-page journal-tags-page">
      <div class="journal-editor-top">
        <a class="journal-link-btn" href="/journal">
          ← Journal
        </a>
      </div>
      <h1>Tags</h1>
      <input
        type="search"
        class="journal-search"
        placeholder="Search tags"
        aria-label="Search tags"
        value={search}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      {merged !== undefined && (
        <p class="journal-muted" role="status">
          {mergedLabel(merged)}
        </p>
      )}
      {tags.isLoading && <p class="journal-muted">Loading…</p>}
      {tags.isError && <p class="journal-error">The tags could not be loaded. Please try again.</p>}
      {tags.isSuccess && shown.length === 0 && (
        <p class="journal-muted">
          {all.length === 0 ? 'No tags yet. Add #hashtags or tags to your entries.' : 'No tag matches.'}
        </p>
      )}
      <ul class="journal-tag-list">
        {shown.map((tag) => (
          <TagRow
            key={tag.tag}
            tag={tag}
            tags={all}
            merging={merging === tag.tag}
            onMergeToggle={() => {
              setMerged(undefined)
              setMerging(merging === tag.tag ? undefined : tag.tag)
            }}
            onMerged={(result) => {
              setMerging(undefined)
              setMerged(result)
            }}
          />
        ))}
      </ul>
    </div>
  )
}
