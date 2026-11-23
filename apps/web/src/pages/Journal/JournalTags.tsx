import type { NoteTagSummary } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchNoteTags, mergeNoteTags } from '../../state/api'
import { entriesLabel, lastUsedLabel, mergeTargetTag, tagFilterHref, tagOptions } from './journal-tags'
import { JOURNAL_KEY, JOURNAL_TAGS_KEY } from './JournalList'

const MergeForm = ({
  from,
  tags,
  onMerged,
}: {
  from: NoteTagSummary
  tags: readonly NoteTagSummary[]
  onMerged: (changed: number) => void
}) => {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const into = mergeTargetTag(typed)
  const merge = useMutation({
    mutationFn: (target: string) => mergeNoteTags([from.tag], target),
    onSuccess: (changed) => {
      void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
      onMerged(changed)
    },
  })
  const listId = `journal-merge-${from.tag}`
  const valid = into !== null && into !== from.tag
  return (
    <form
      class="journal-tag-merge"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !merge.isPending) merge.mutate(into)
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
      <button type="submit" class="btn-primary" disabled={!valid || merge.isPending}>
        {valid ? `Merge #${from.tag} (${entriesLabel(from.count)}) into #${into}` : 'Merge'}
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
  onMerged: (changed: number) => void
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
  const [merged, setMerged] = useState<number>()
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
          Merged: {entriesLabel(merged)} changed.
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
            onMerged={(changed) => {
              setMerging(undefined)
              setMerged(changed)
            }}
          />
        ))}
      </ul>
    </div>
  )
}
