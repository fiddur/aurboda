import type { Person } from '@aurboda/api-spec'

import { useRef, useState } from 'preact/hooks'

import { MarkdownEditor } from '../../components/MarkdownEditor'
import { MentionMenu, usePeople } from './Related'
import { insertMention, mentionAt, mentionOptions, moveChoice, offeredPeople } from './related'

/**
 * The entry's text, where typing `@` offers the user's people: arrow keys and Enter (or a tap) pick
 * one, Esc closes. Picking writes the name in place of the `@query` and hands the person on.
 */
export const MentionEditor = ({
  value,
  onChange,
  onMention,
  onBlur,
  attachPictures,
}: {
  value: string
  onChange: (content: string) => void
  onMention: (content: string, person: Person) => void
  onBlur: () => void
  attachPictures: (files: File[]) => void
}) => {
  const people = offeredPeople(usePeople().data?.people ?? [])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [caret, setCaret] = useState<number | undefined>(undefined)
  const [choice, setChoice] = useState(0)
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)

  const typed = caret === undefined ? null : mentionAt(value, caret)
  const mention = typed && typed.start !== dismissed ? typed : null
  const options = mention ? mentionOptions(people, mention.query) : []

  const readCaret = () => setCaret(textareaRef.current?.selectionStart ?? undefined)

  const pick = (person: Person) => {
    if (!mention) return
    const cursor = textareaRef.current?.selectionStart ?? caret ?? value.length
    const next = insertMention(value, mention.start, cursor, person.name)
    onMention(next.text, person)
    setCaret(undefined)
    setChoice(0)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const keys = (e: KeyboardEvent) => {
    if (!mention || options.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setChoice(moveChoice(choice, e.key === 'ArrowDown' ? 1 : -1, options.length))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pick(options[Math.min(choice, options.length - 1)]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(mention.start)
    }
  }

  return (
    <div class="journal-mention-wrap">
      <MarkdownEditor
        value={value}
        onChange={(content) => {
          onChange(content)
          readCaret()
          setChoice(0)
        }}
        placeholder="Write what happened, what you thought, how it felt…"
        rows={10}
        ariaLabel="Entry text"
        onBlur={() => {
          setCaret(undefined)
          onBlur()
        }}
        textareaRef={textareaRef}
        onKeyDown={keys}
        onCaret={readCaret}
        attachPictures={attachPictures}
        attachHint="Paste, drop or pick pictures to add them to this entry, in order. Type @ to name someone."
      />
      {mention && <MentionMenu options={options} active={choice} onPick={pick} />}
    </div>
  )
}
