import type { JournalContext, Note, NoteAttachment, NoteRevision, NoteTemplate } from '@aurboda/api-spec'

import { DELETED_NOTE_RETENTION_DAYS, NOTE_TITLE_MAX_LENGTH } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'

import { CommentThread } from '../../components/CommentThread'
import { stepActiveIndex } from '../../components/knownValueSuggestions'
import '../../components/KnownValuesInput.css'
import {
  insertOnOwnLine,
  stillUploading,
  withoutUploadPlaceholders,
} from '../../components/MarkdownEditor/image-upload'
import {
  addReply,
  apiErrorMessage,
  createJournalEntry,
  deleteComment,
  deleteJournalEntry,
  deleteNoteAttachment,
  fetchNote,
  fetchNoteRevisions,
  fetchNoteTags,
  restoreJournalEntry,
  restoreNoteAttachment,
  updateComment,
  updateJournalEntry,
  uploadNoteAttachment,
} from '../../state/api'
import { auth } from '../../state/auth'
import { ATTACHMENT_SCHEME } from '../../utils/attachment-ref'
import { browserTimezone } from '../../utils/browserTimezone'
import { renderMarkdown } from '../../utils/markdown'
import { PictureThumb, PictureViewer, RecordingPlayer } from './Attachments'
import { mergeAttachments } from './attachments-merge'
import { type AutosaveStatus, autosaveLabel, createAutosaver, type SaveOutcome } from './autosave'
import { type ConflictChoice, resolveConflict } from './conflict'
import {
  browserStorage,
  draftStorageFor,
  draftToOffer,
  type EntryDraft,
  loadDraft,
  moveDraft,
  NEW_ENTRY_KEY,
  removeDraft,
  saveDraft,
  clearDraftIfConfirmed,
} from './draft-store'
import {
  addTags,
  emptyEntryForm,
  entryDay,
  type EntryForm,
  entryFormProblem,
  entryTimelineHref,
  formFromNote,
  formToCreateBody,
  formToUpdateBody,
  discardOnLeave,
  isEntryEmpty,
  tagChips,
} from './entry-form'
import { type EntryMode, initialEntryMode } from './entry-mode'
import { EntryContextLine } from './EntryContextLine'
import { EntryNeighbors } from './EntryNeighbors'
import { EntryReadView } from './EntryReadView'
import { attachmentImageMarkdown, pictureOrder, withoutInline } from './inline-pictures'
import { entryGlimpse } from './journal-list'
import { completeTyped, tagSuggestions } from './journal-tags'
import { JOURNAL_KEY, JOURNAL_TAGS_KEY } from './JournalList'
import { LinkSuggestions } from './LinkSuggestions'
import { MentionEditor } from './MentionEditor'
import { neighborAnchorKey } from './neighbors'
import { Recorder } from './Recorder'
import { RelatedRow } from './Related'
import { addLink, personLink, type RelatedLink, refusedLinkKeys } from './related'
import { useTemplates } from './Templates'

const UNDO_MS = 10_000
const ATTACHMENT_UNDO_MS = 6000

const uploadProblem = (error: unknown): string => {
  const status =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined
  if (status === 413) return 'That file is too large (at most 20 MB).'
  if (status === 409) return 'This entry, or your account, holds as many files as it may.'
  if (status === 400 || status === 415) return 'That file is not a picture or recording Aurboda can keep.'
  return 'The file could not be added. Please try again.'
}

const sortByPosition = (list: NoteAttachment[]) => [...list].sort((a, b) => a.position - b.position)

/** The entry as it may be saved while pictures are still on their way: without their placeholders. */
const savable = (form: EntryForm): EntryForm =>
  stillUploading(form.content) ? { ...form, content: withoutUploadPlaceholders(form.content) } : form

const withPictureAtEnd = (content: string, attachmentId: string): string =>
  insertOnOwnLine(content, content.length, attachmentImageMarkdown(attachmentId)).value

const TagEditor = ({
  tags,
  content,
  onChange,
}: {
  tags: string[]
  content: string
  onChange: (tags: string[]) => void
}) => {
  const listId = useId()
  const [typed, setTyped] = useState('')
  const [rejected, setRejected] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const known = useQuery({ queryFn: () => fetchNoteTags(), queryKey: JOURNAL_TAGS_KEY })
  const chips = tagChips(tags, content)
  const suggestions = useMemo(
    () =>
      tagSuggestions(
        known.data ?? [],
        typed,
        chips.map((chip) => chip.tag),
      ),
    [known.data, typed, tags, content],
  )
  const expanded = open && suggestions.length > 0

  const add = (text: string) => {
    if (!text.trim()) return
    const result = addTags(tags, text)
    setRejected(result.rejected)
    setTyped('')
    setActiveIndex(-1)
    if (result.tags.length !== tags.length) onChange(result.tags)
  }
  const pick = (tag: string) => add(completeTyped(typed, tag))

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!expanded) {
        setOpen(true)
        return
      }
      setActiveIndex((current) =>
        stepActiveIndex(current, e.key === 'ArrowDown' ? 1 : -1, suggestions.length),
      )
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      if (expanded && activeIndex >= 0) pick(suggestions[activeIndex].tag)
      else add(typed)
    } else if (e.key === ',') {
      e.preventDefault()
      add(typed)
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div class="journal-field">
      <span>Tags</span>
      <div class="journal-tag-editor">
        {chips.map((chip) =>
          chip.fromText ? (
            <span key={chip.tag} class="journal-chip from-text" title="From the text">
              #{chip.tag}
            </span>
          ) : (
            <button
              key={chip.tag}
              type="button"
              class="journal-chip"
              aria-label={`Remove #${chip.tag}`}
              onClick={() => onChange(tags.filter((t) => t !== chip.tag))}
            >
              #{chip.tag} ✕
            </button>
          ),
        )}
        <span class="known-values journal-tag-input">
          <input
            type="text"
            value={typed}
            placeholder="Add a tag"
            aria-label="Add a tag"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onInput={(e) => {
              setTyped(e.currentTarget.value)
              setActiveIndex(-1)
              setOpen(true)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false)
              add(typed)
            }}
          />
          {expanded && (
            <ul id={listId} role="listbox" class="known-values-list" onMouseDown={(e) => e.preventDefault()}>
              {suggestions.map((tag, i) => (
                <li
                  key={tag.tag}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  class={`known-values-option${i === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => pick(tag.tag)}
                >
                  <span class="known-values-value">#{tag.tag}</span>
                  <span class="known-values-count">{tag.count}</span>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
      {rejected.length > 0 && (
        <small class="journal-error">Not a tag: {rejected.join(', ')} (letters, digits and _ only)</small>
      )}
    </div>
  )
}

const WhenFields = ({
  form,
  onChange,
}: {
  form: EntryForm
  onChange: (patch: Partial<EntryForm>) => void
}) => (
  <div class="journal-when">
    <label class="journal-switch">
      <input
        type="checkbox"
        checked={form.allDay}
        onChange={(e) => {
          const allDay = e.currentTarget.checked
          if (allDay) onChange({ allDay, date: form.start.slice(0, 10) || form.date })
          else onChange({ allDay, start: `${form.date}T${form.start.slice(11, 16) || '12:00'}` })
        }}
      />
      <span>No time of day</span>
    </label>
    {form.allDay ? (
      <label class="journal-field">
        <span>Date</span>
        <input type="date" value={form.date} onInput={(e) => onChange({ date: e.currentTarget.value })} />
      </label>
    ) : (
      <div class="journal-times">
        <label class="journal-field">
          <span>When</span>
          <input
            type="datetime-local"
            value={form.start}
            onInput={(e) => onChange({ start: e.currentTarget.value })}
          />
        </label>
        <label class="journal-field">
          <span>
            Until <small>(optional)</small>
          </span>
          <input
            type="datetime-local"
            value={form.end}
            onInput={(e) => onChange({ end: e.currentTarget.value })}
          />
        </label>
      </div>
    )}
  </div>
)

const ConflictPanel = ({
  mine,
  theirs,
  onChoose,
}: {
  mine: EntryForm
  theirs: Note
  onChoose: (choice: ConflictChoice) => void
}) => (
  <section
    class="journal-card journal-conflict"
    role="alertdialog"
    aria-label="This entry was changed elsewhere"
  >
    <h2>This entry was changed elsewhere</h2>
    <p class="journal-muted">
      Someone (perhaps you, in another tab or on your phone) saved a different version while you were writing.
      Nothing is lost: choose what to keep.
    </p>
    <div class="journal-conflict-versions">
      <div>
        <h3>
          Their version{' '}
          <small class="journal-muted">
            saved {theirs.updated_at ? format(new Date(theirs.updated_at), 'HH:mm') : ''}
          </small>
        </h3>
        {theirs.title && <p class="journal-conflict-title">{theirs.title}</p>}
        <div
          class="journal-conflict-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(theirs.content) }}
        />
      </div>
      <div>
        <h3>Your version</h3>
        {mine.title && <p class="journal-conflict-title">{mine.title}</p>}
        <div
          class="journal-conflict-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(mine.content) }}
        />
      </div>
    </div>
    <div class="journal-row">
      <button type="button" class="btn-primary" onClick={() => onChoose('mine')}>
        Keep mine
      </button>
      <button type="button" class="btn-secondary" onClick={() => onChoose('theirs')}>
        Keep theirs
      </button>
      <button type="button" class="btn-secondary" onClick={() => onChoose('both')}>
        Keep both
      </button>
    </div>
  </section>
)

const History = ({ id, onRestore }: { id: string; onRestore: (revision: NoteRevision) => void }) => {
  const revisions = useQuery({ queryFn: () => fetchNoteRevisions(id), queryKey: ['note-revisions', id] })
  const list = revisions.data ?? []
  return (
    <section class="journal-card journal-history" aria-label="History">
      <h2>History</h2>
      {revisions.isLoading && <p class="journal-muted">Loading…</p>}
      {!revisions.isLoading && list.length === 0 && (
        <p class="journal-muted">No earlier versions yet. One is kept each time you come back to edit.</p>
      )}
      <ul>
        {list.map((revision) => (
          <li key={revision.id}>
            <div>
              <strong>{format(new Date(revision.saved_at), 'd MMM yyyy, HH:mm')}</strong>
              <p class="journal-muted">{entryGlimpse(revision, 140) || '(empty)'}</p>
            </div>
            <button type="button" class="btn-secondary" onClick={() => onRestore(revision)}>
              Restore this version
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const DeletedNotice = ({ onUndo }: { onUndo: () => void }) => (
  <div class="page journal-page journal-editor-page">
    <div class="journal-card journal-deleted-notice" role="status">
      <p>
        Entry deleted.{' '}
        <button type="button" class="journal-link-btn" onClick={onUndo}>
          Undo
        </button>
      </p>
      <p class="journal-muted">
        It stays in Recently deleted for {DELETED_NOTE_RETENTION_DAYS} days. Going back to the journal…
      </p>
      <a href="/journal">Back to the journal now</a>
    </div>
  </div>
)

const StatusLine = ({
  status,
  problem,
  isNew,
}: {
  status: AutosaveStatus
  problem: string | undefined
  isNew: boolean
}) => {
  const text =
    problem && status === 'retrying'
      ? `Not saved: ${problem}`
      : isNew && status === 'saved'
        ? ''
        : autosaveLabel(status)
  return (
    <span class={`journal-status status-${status}`} role="status" aria-live="polite">
      {text}
    </span>
  )
}

const DraftOffer = ({
  draft,
  onUse,
  onDiscard,
}: {
  draft: EntryDraft
  onUse: () => void
  onDiscard: () => void
}) => (
  <div class="journal-card journal-offer" role="alert">
    <p>You have unsaved text from {format(new Date(draft.edited_at), 'd MMM, HH:mm')}.</p>
    <p class="journal-muted journal-offer-glimpse">{entryGlimpse(draft.form, 160)}</p>
    <div class="journal-row">
      <button type="button" class="btn-primary" onClick={onUse}>
        Use it
      </button>
      <button type="button" class="btn-secondary" onClick={onDiscard}>
        Discard
      </button>
    </div>
  </div>
)

const timelineLink = (form: EntryForm) => {
  const href = entryTimelineHref(form)
  if (!href) return undefined
  return {
    href,
    title: form.allDay ? 'Show the day on the timeline' : 'Show the 24 hours around it on the timeline',
  }
}

const EditorFiles = ({
  noteId,
  attachments,
  content,
  busy,
  problem,
  removed,
  onOpen,
  onRemove,
  onPutInText,
  onUndo,
}: {
  noteId: string | undefined
  attachments: NoteAttachment[]
  content: string
  busy: string | undefined
  problem: string | undefined
  removed: NoteAttachment | undefined
  onOpen: (attachment: NoteAttachment) => void
  onRemove: (attachment: NoteAttachment) => void
  onPutInText: (attachment: NoteAttachment) => void
  onUndo: () => void
}) => {
  const pictures = withoutInline(
    attachments.filter((a) => a.kind === 'image'),
    content,
  )
  const recordings = attachments.filter((a) => a.kind === 'audio')
  if (pictures.length === 0 && recordings.length === 0 && !busy && !problem && !removed) return null
  return (
    <div class="journal-editor-files">
      {noteId && pictures.length > 0 && (
        <ol class="journal-thumbs journal-editor-thumbs">
          {pictures.map((picture, index) => (
            <li key={picture.id}>
              <PictureThumb
                noteId={noteId}
                attachment={picture}
                label={`Picture ${index + 1} of ${pictures.length}`}
                onOpen={() => onOpen(picture)}
              />
              <button
                type="button"
                class="journal-link-btn"
                onClick={() => onPutInText(picture)}
                aria-label={`Put picture ${index + 1} in the text`}
              >
                Put in text
              </button>
              <button
                type="button"
                class="journal-link-btn"
                onClick={() => onRemove(picture)}
                aria-label={`Remove picture ${index + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      {noteId &&
        recordings.map((recording) => (
          <div class="journal-recording" key={recording.id}>
            <RecordingPlayer noteId={noteId} attachment={recording} />
            <button type="button" class="journal-link-btn" onClick={() => onRemove(recording)}>
              Remove
            </button>
          </div>
        ))}
      {busy && <p class="journal-muted">{busy}</p>}
      {problem && (
        <p class="journal-error" role="alert">
          {problem}
        </p>
      )}
      {removed && (
        <p class="journal-muted" role="status">
          {removed.kind === 'image' ? 'Picture removed.' : 'Recording removed.'}{' '}
          <button type="button" class="journal-link-btn" onClick={onUndo}>
            Undo
          </button>
        </p>
      )}
    </div>
  )
}

const EditorTools = ({
  busy,
  templates,
  onFiles,
  onTemplate,
}: {
  busy: boolean
  templates: NoteTemplate[]
  onFiles: (files: Blob[], names?: string[]) => void
  onTemplate: (content: string) => void
}) => (
  <div class="journal-editor-tools">
    <label class="btn-secondary journal-file-btn">
      🖼 Add pictures
      <input
        type="file"
        class="md-editor-visually-hidden"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
        multiple
        onChange={(e) => {
          const input = e.currentTarget
          const chosen = [...(input.files ?? [])]
          input.value = ''
          if (chosen.length > 0) onFiles(chosen)
        }}
      />
    </label>
    <Recorder disabled={busy} onRecorded={(blob, name) => onFiles([blob], [name])} />
    {templates.length > 0 && (
      <select
        class="journal-template-select"
        aria-label="From template"
        value=""
        onChange={(e) => {
          const template = templates.find((t) => t.id === e.currentTarget.value)
          e.currentTarget.value = ''
          if (template) onTemplate(template.content)
        }}
      >
        <option value="">From template…</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
    )}
  </div>
)

const EntryText = ({
  mode,
  onEdit,
  onDone,
  ...editor
}: Parameters<typeof MentionEditor>[0] & {
  mode: EntryMode
  onEdit: () => void
  onDone: () => void
}) =>
  mode === 'read' ? (
    <EntryReadView
      content={editor.value}
      noteId={editor.noteId}
      onEdit={onEdit}
      onOpenPicture={editor.onOpenPicture}
    />
  ) : (
    <div class="journal-write">
      <MentionEditor {...editor} />
      <div class="journal-write-done">
        <button type="button" class="btn-secondary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )

/** Replace the editor's URL without a navigation: the router would remount the editor mid-sentence. */
const replaceUrl = (path: string) => {
  try {
    history.replaceState(
      history.state,
      '',
      `${path}${window.location.search.replace(/[?&]template=[^&]*/, '')}`,
    )
  } catch {
    /* not in a browser */
  }
}

/**
 * The focused editor for one entry (`id`) or a new one. Text is never lost: it autosaves, keeps a
 * local draft until the server confirms it, and refuses to overwrite a version saved elsewhere.
 */
export const EntryEditor = ({ id: initialId, templateId }: { id?: string; templateId?: string }) => {
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const storage = useMemo(() => draftStorageFor(browserStorage(), auth.value.user), [])
  const templates = useTemplates()

  const idRef = useRef<string | undefined>(initialId)
  const updatedAtRef = useRef<string | undefined>(undefined)
  const creating = useRef<Promise<string> | undefined>(undefined)
  const attachmentsRef = useRef<NoteAttachment[]>([])
  const addedRef = useRef<string[]>([])
  const savedRelatedRef = useRef<RelatedLink[]>([])

  const [loaded, setLoaded] = useState(initialId === undefined)
  const [loadError, setLoadError] = useState(false)
  const [form, setForm] = useState<EntryForm>(() => emptyEntryForm())
  const formRef = useRef(form)
  formRef.current = form
  const [attachments, setAttachmentsState] = useState<NoteAttachment[]>([])
  const [threadRoot, setThreadRoot] = useState<Note | undefined>(undefined)
  const [noteContext, setNoteContext] = useState<JournalContext | undefined>(undefined)
  const [status, setStatus] = useState<AutosaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined)
  const [goneLinks, setGoneLinks] = useState<ReadonlySet<string>>(new Set())
  const [conflict, setConflict] = useState<Note | undefined>(undefined)
  const [offer, setOffer] = useState<EntryDraft | undefined>(undefined)
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [fileProblem, setFileProblem] = useState<string | undefined>(undefined)
  const [viewing, setViewing] = useState<string | undefined>(undefined)
  const [removed, setRemoved] = useState<NoteAttachment | undefined>(undefined)
  const [deleted, setDeleted] = useState(false)
  const deletedRef = useRef(false)
  const [mode, setMode] = useState<EntryMode>(() =>
    initialEntryMode({ content: '', isNew: initialId === undefined }),
  )
  const [focusText, setFocusText] = useState(false)
  const startEditing = (focus: boolean) => {
    setFocusText(focus)
    setMode('edit')
  }

  const setAttachments = (next: NoteAttachment[]) => {
    attachmentsRef.current = next
    setAttachmentsState(next)
  }

  const draftKey = () => idRef.current ?? NEW_ENTRY_KEY

  const accept = useCallback(
    (note: Note, sent: EntryForm, addedBefore: number) => {
      updatedAtRef.current = note.updated_at
      setSavedAt(note.updated_at)
      savedRelatedRef.current = note.related ?? sent.related
      setGoneLinks((current) => (current.size === 0 ? current : new Set()))
      if (note.attachments) {
        const addedSince = new Set(addedRef.current.slice(addedBefore))
        setAttachments(sortByPosition(mergeAttachments(note.attachments, attachmentsRef.current, addedSince)))
      }
      setThreadRoot((current) => current ?? { ...note, replies: [] })
      clearDraftIfConfirmed(storage, draftKey(), sent)
      void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
    },
    [queryClient, storage],
  )

  const createEntry = useCallback(
    async (sent: EntryForm): Promise<string> => {
      if (idRef.current) return idRef.current
      if (creating.current) return creating.current
      creating.current = (async () => {
        const addedBefore = addedRef.current.length
        const note = await createJournalEntry(formToCreateBody(savable(sent)))
        const id = note.id!
        idRef.current = id
        moveDraft(storage, NEW_ENTRY_KEY, id)
        replaceUrl(`/journal/${encodeURIComponent(id)}`)
        accept(note, sent, addedBefore)
        return id
      })()
      try {
        return await creating.current
      } finally {
        creating.current = undefined
      }
    },
    [accept, storage],
  )

  const save = useCallback(
    async (edited: EntryForm): Promise<SaveOutcome> => {
      const sent = savable(edited)
      const problem = entryFormProblem(sent)
      setSaveProblem(problem)
      if (problem) throw new Error(problem)
      try {
        if (!idRef.current) {
          if (isEntryEmpty(sent, attachmentsRef.current.length)) return { kind: 'saved' }
          await createEntry(sent)
          return { kind: 'saved' }
        }
        const addedBefore = addedRef.current.length
        const result = await updateJournalEntry(
          idRef.current,
          formToUpdateBody(sent, updatedAtRef.current, savedRelatedRef.current),
        )
        if (result.kind === 'conflict') {
          setConflict(result.note)
          return { kind: 'conflict' }
        }
        accept(result.note, sent, addedBefore)
        return { kind: 'saved' }
      } catch (error) {
        const refused = refusedLinkKeys(apiErrorMessage(error, ''), sent.related)
        if (refused.size > 0) {
          setGoneLinks(refused)
          setSaveProblem('something it is related to was removed. Remove the marked link.')
        }
        throw error
      }
    },
    [accept, createEntry],
  )

  const saveRef = useRef(save)
  saveRef.current = save
  const autosaver = useMemo(
    () => createAutosaver<EntryForm>({ onStatus: setStatus, save: (value) => saveRef.current(value) }),
    [],
  )

  const edit = useCallback(
    (next: EntryForm) => {
      formRef.current = next
      setForm(next)
      saveDraft(storage, { edited_at: Date.now(), form: next, key: draftKey() })
      autosaver.change(next)
    },
    [autosaver, storage],
  )
  const patch = (changes: Partial<EntryForm>) => edit({ ...formRef.current, ...changes })

  useEffect(() => {
    if (initialId === undefined) {
      const template = templates.data?.find((t) => t.id === templateId)
      const draft = draftToOffer(loadDraft(storage, NEW_ENTRY_KEY), undefined)
      if (draft) setOffer(draft)
      if (template && !draft) setForm(emptyEntryForm(new Date(), template.content))
      return
    }
    let cancelled = false
    fetchNote(initialId, browserTimezone() ?? undefined)
      .then((note) => {
        if (cancelled) return
        const serverForm = formFromNote(note)
        setNoteContext(note.context)
        updatedAtRef.current = note.updated_at
        setSavedAt(note.updated_at)
        savedRelatedRef.current = serverForm.related
        setForm(serverForm)
        setAttachments(sortByPosition(note.attachments ?? []))
        setThreadRoot(note)
        const draft = draftToOffer(loadDraft(storage, initialId), {
          form: serverForm,
          updated_at: note.updated_at,
        })
        if (draft) setOffer(draft)
        else removeDraft(storage, initialId)
        setMode(initialEntryMode({ content: serverForm.content, isNew: false }))
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        const draft = loadDraft(storage, initialId)
        if (draft) setOffer(draft)
        setLoadError(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per entry; the template list may arrive later
  }, [initialId])

  useEffect(() => {
    if (initialId !== undefined || !templateId || !templates.data) return
    const template = templates.data.find((t) => t.id === templateId)
    if (template && formRef.current.content === '' && !offer) {
      setForm(emptyEntryForm(new Date(), template.content))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the templates arrive
  }, [templates.data])

  const discardIfEmpty = useCallback(async () => {
    const opened = { deleted: deletedRef.current, savedEntry: initialId !== undefined }
    if (!discardOnLeave(opened, isEntryEmpty(formRef.current, attachmentsRef.current.length))) return
    removeDraft(storage, draftKey())
    if (idRef.current) await deleteJournalEntry(idRef.current).catch(() => undefined)
  }, [initialId, storage])

  useEffect(() => {
    const onHide = () => void autosaver.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void autosaver.flush().then(() => {
        autosaver.stop()
        return discardIfEmpty()
      })
    }
  }, [autosaver, discardIfEmpty])

  const leave = async () => {
    await autosaver.flush()
    await discardIfEmpty()
    autosaver.stop()
    route('/journal')
  }

  const chooseVersion = (choice: ConflictChoice) => {
    if (!conflict) return
    const resolved = resolveConflict(choice, formRef.current, formFromNote(conflict))
    updatedAtRef.current = conflict.updated_at
    setSavedAt(conflict.updated_at)
    savedRelatedRef.current = conflict.related ?? []
    if (conflict.attachments) setAttachments(sortByPosition(conflict.attachments))
    setConflict(undefined)
    formRef.current = resolved
    setForm(resolved)
    saveDraft(storage, { edited_at: Date.now(), form: resolved, key: draftKey() })
    autosaver.resume(resolved)
    startEditing(false)
  }

  const takeOffer = () => {
    if (!offer) return
    edit(offer.form)
    setOffer(undefined)
    startEditing(false)
  }

  const discardOffer = () => {
    setOffer(undefined)
    if (idRef.current) clearDraftIfConfirmed(storage, idRef.current, offer?.form ?? form)
    removeDraft(storage, offer?.key ?? draftKey())
  }

  const ensureEntry = async (): Promise<string> => {
    await autosaver.flush()
    return createEntry(formRef.current)
  }

  const keepFile = async (id: string, file: Blob, name: string | undefined): Promise<NoteAttachment> => {
    const attachment = await uploadNoteAttachment(id, file, name)
    addedRef.current.push(attachment.id)
    setAttachments(sortByPosition([...attachmentsRef.current, attachment]))
    return attachment
  }

  const addFiles = async (
    files: readonly Blob[],
    names: string[] = files.map((f) => (f instanceof File ? f.name : '')),
  ) => {
    setFileProblem(undefined)
    try {
      const id = await ensureEntry()
      for (const [index, file] of files.entries()) {
        setBusy(files.length > 1 ? `Adding ${index + 1} of ${files.length}…` : 'Adding…')
        await keepFile(id, file, names[index] || undefined)
      }
      void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
    } catch (error) {
      setFileProblem(uploadProblem(error))
    } finally {
      setBusy(undefined)
    }
  }

  const uploadInline = async (file: File): Promise<{ url: string }> => {
    const attachment = await keepFile(await ensureEntry(), file, file.name || undefined)
    void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
    return { url: `${ATTACHMENT_SCHEME}${attachment.id}` }
  }

  const putInText = (attachment: NoteAttachment) => {
    patch({ content: withPictureAtEnd(formRef.current.content, attachment.id) })
    startEditing(false)
  }

  const removeAttachment = async (attachment: NoteAttachment) => {
    if (!idRef.current) return
    setAttachments(attachmentsRef.current.filter((a) => a.id !== attachment.id))
    setRemoved(attachment)
    try {
      await deleteNoteAttachment(idRef.current, attachment.id)
    } catch {
      setAttachments(sortByPosition([...attachmentsRef.current, attachment]))
      setRemoved(undefined)
      setFileProblem('The file could not be removed. Please try again.')
    }
  }

  useEffect(() => {
    if (!removed) return
    const timer = setTimeout(() => setRemoved(undefined), ATTACHMENT_UNDO_MS)
    return () => clearTimeout(timer)
  }, [removed])

  const undoRemove = async () => {
    if (!removed || !idRef.current) return
    const back = removed
    setRemoved(undefined)
    try {
      const restored = await restoreNoteAttachment(idRef.current, back.id)
      addedRef.current.push(restored.id)
      setAttachments(sortByPosition([...attachmentsRef.current, restored]))
    } catch {
      setFileProblem('The file could not be brought back.')
    }
  }

  const deleteEntry = async () => {
    autosaver.stop()
    const id = idRef.current
    if (!id) {
      removeDraft(storage, NEW_ENTRY_KEY)
      route('/journal')
      return
    }
    await autosaver.flush().catch(() => undefined)
    const { purged } = await deleteJournalEntry(id)
    deletedRef.current = true
    removeDraft(storage, id)
    void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
    if (purged) route('/journal')
    else setDeleted(true)
  }

  useEffect(() => {
    if (!deleted) return
    const timer = setTimeout(() => route('/journal'), UNDO_MS)
    return () => clearTimeout(timer)
  }, [deleted, route])

  const undoDelete = async () => {
    if (!idRef.current) return
    const note = await restoreJournalEntry(idRef.current)
    updatedAtRef.current = note.updated_at
    deletedRef.current = false
    void queryClient.invalidateQueries({ queryKey: JOURNAL_KEY })
    setDeleted(false)
  }

  const applyTemplate = (content: string) => {
    if (form.content.trim() && !confirm('Replace the text with the template?')) return
    patch({ content })
    startEditing(false)
  }

  const refreshReplies = async () => {
    if (!idRef.current) return
    const note = await fetchNote(idRef.current)
    setThreadRoot(note)
  }
  const threadMutation = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: () => refreshReplies(),
  })

  if (deleted) return <DeletedNotice onUndo={() => void undoDelete()} />

  const flush = () => void autosaver.flush()
  const doneEditing = async () => {
    await autosaver.flush()
    setMode('read')
  }

  return (
    <div class="page journal-page journal-editor-page">
      <div class="journal-editor-top">
        <button type="button" class="journal-link-btn" onClick={() => void leave()}>
          ← Journal
        </button>
        <StatusLine status={status} problem={saveProblem} isNew={!idRef.current} />
      </div>

      <EntryNeighbors
        id={idRef.current}
        loaded={loaded}
        anchorKey={neighborAnchorKey(form)}
        timeline={timelineLink(form)}
      />

      {loadError && (
        <p class="journal-error" role="alert">
          This entry could not be loaded. It may have been deleted.
        </p>
      )}

      {offer && <DraftOffer draft={offer} onUse={takeOffer} onDiscard={discardOffer} />}

      {conflict && <ConflictPanel mine={form} theirs={conflict} onChoose={chooseVersion} />}

      {loaded && (
        <div class="journal-editor">
          <input
            type="text"
            class="journal-title-input"
            placeholder="Title (optional)"
            aria-label="Title"
            maxLength={NOTE_TITLE_MAX_LENGTH}
            value={form.title}
            onInput={(e) => patch({ title: e.currentTarget.value })}
            onBlur={flush}
          />
          <EntryContextLine context={noteContext} date={entryDay(form)} />
          <EntryText
            mode={mode}
            onEdit={() => startEditing(true)}
            onDone={() => void doneEditing()}
            autoFocus={focusText}
            value={form.content}
            onChange={(content) => patch({ content })}
            onMention={(content, person) =>
              patch({ content, related: addLink(formRef.current.related, personLink(person)) })
            }
            onBlur={flush}
            noteId={idRef.current}
            upload={uploadInline}
            uploadFailureMessage={uploadProblem}
            onOpenPicture={setViewing}
          />

          <RelatedRow
            links={form.related}
            gone={goneLinks}
            entryDate={entryDay(form)}
            onChange={(related) => patch({ related })}
          />

          <LinkSuggestions
            noteId={idRef.current}
            savedAt={savedAt}
            links={form.related}
            onAdd={(link) => patch({ related: addLink(formRef.current.related, link) })}
          />

          <EditorFiles
            noteId={idRef.current}
            attachments={attachments}
            content={form.content}
            busy={busy}
            problem={fileProblem}
            removed={removed}
            onOpen={(attachment) => setViewing(attachment.id)}
            onRemove={(attachment) => void removeAttachment(attachment)}
            onPutInText={putInText}
            onUndo={() => void undoRemove()}
          />

          <EditorTools
            busy={busy !== undefined}
            templates={templates.data ?? []}
            onFiles={(files) => void addFiles(files)}
            onTemplate={applyTemplate}
          />

          <WhenFields form={form} onChange={patch} />
          <TagEditor tags={form.tags} content={form.content} onChange={(tags) => patch({ tags })} />

          <div class="journal-editor-actions">
            {idRef.current && (
              <button type="button" class="btn-secondary" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? 'Hide history' : 'History'}
              </button>
            )}
            <button type="button" class="btn-danger" onClick={() => void deleteEntry()}>
              Delete
            </button>
          </div>

          {showHistory && idRef.current && (
            <History
              id={idRef.current}
              onRestore={(revision) => {
                patch({ content: revision.content, title: revision.title ?? '' })
                setShowHistory(false)
                startEditing(false)
              }}
            />
          )}

          {idRef.current && threadRoot && (
            <section class="journal-thread" aria-label="Replies">
              <h2>Replies</h2>
              <CommentThread
                comments={[threadRoot]}
                repliesOnly
                pending={threadMutation.isPending}
                onAddReply={(rootId, content) => threadMutation.mutate(() => addReply(rootId, content))}
                onEdit={(replyId, content) =>
                  threadMutation.mutate(() => updateComment(replyId, { content }))
                }
                onDelete={(replyId) => threadMutation.mutate(() => deleteComment(replyId))}
              />
            </section>
          )}
        </div>
      )}

      {viewing && idRef.current && (
        <PictureViewer
          noteId={idRef.current}
          attachmentId={viewing}
          pictureIds={pictureOrder(attachments, form.content)}
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  )
}
