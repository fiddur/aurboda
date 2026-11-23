import type { Person } from '@aurboda/api-spec'
import type { JSX } from 'preact'

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { MarkdownEditor } from '../../components/MarkdownEditor'
import { caretLineRect } from './caret-position'
import { type MentionPlacement, mentionMenuPlacement } from './mention-placement'
import { MentionMenu, useAddPerson, usePeople } from './Related'
import {
  highlighted,
  insertMention,
  keyPicks,
  type MentionItem,
  mentionAt,
  mentionItems,
  moveChoice,
  offeredPeople,
} from './related'

interface Typed {
  start: number
  query: string
}

interface MentionRefs {
  textareaRef: { current: HTMLTextAreaElement | null }
  wrapRef: { current: HTMLDivElement | null }
  menuRef: { current: HTMLUListElement | null }
}

/** Where the open menu sits for the `@` at `anchor`, kept up to date while the page, the text or the keyboard moves. */
const useMentionPlacement = (
  anchor: number | undefined,
  value: string,
  count: number,
  { textareaRef, wrapRef, menuRef }: MentionRefs,
): MentionPlacement | null => {
  const [placement, setPlacement] = useState<MentionPlacement | null>(null)
  useLayoutEffect(() => {
    if (anchor === undefined) {
      setPlacement(null)
      return
    }
    const place = (e?: Event) => {
      if (e?.target === menuRef.current) return
      const textarea = textareaRef.current
      const wrap = wrapRef.current
      if (!textarea || !wrap) return
      const caretLine = caretLineRect(textarea, anchor)
      const wrapRect = wrap.getBoundingClientRect()
      const viewport = window.visualViewport
      const visibleTop = viewport ? viewport.offsetTop : 0
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      setPlacement(
        mentionMenuPlacement({
          cap: Math.min(256, 0.4 * (visibleBottom - visibleTop)),
          caretBottom: caretLine.bottom,
          caretTop: caretLine.top,
          visibleBottom,
          visibleTop,
          wrapBottom: wrapRect.bottom,
          wrapTop: wrapRect.top,
        }),
      )
    }
    place()
    const textarea = textareaRef.current
    const viewport = window.visualViewport
    textarea?.addEventListener('scroll', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      textarea?.removeEventListener('scroll', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
    }
  }, [anchor, value, count])

  return placement
}

const menuStyle = (placement: MentionPlacement | null): JSX.CSSProperties =>
  placement
    ? {
        [placement.side === 'below' ? 'top' : 'bottom']: `${placement.offset}px`,
        maxHeight: `${placement.maxHeight}px`,
      }
    : { visibility: 'hidden' }

/** While a new person is being saved after the `@query` has gone, only that item stays: no one else can be picked then. */
const menuItems = (items: MentionItem<Person>[], typing: boolean): MentionItem<Person>[] =>
  typing ? items : items.filter((item) => item.kind === 'new')

/**
 * The entry's text, where typing `@` offers the user's people, and adding the typed name as a new
 * one: arrow keys and Enter (or a tap) pick, Esc closes. Picking writes the name in place of the
 * `@query` and hands the person on.
 */
export const MentionEditor = ({
  value,
  onChange,
  onMention,
  onBlur,
  attachPictures,
  autoFocus,
}: {
  value: string
  onChange: (content: string) => void
  onMention: (content: string, person: Person) => void
  onBlur: () => void
  attachPictures: (files: File[]) => void
  /** Focus the text with the caret at its end once shown. */
  autoFocus?: boolean
}) => {
  const peopleQuery = usePeople()
  const allPeople = peopleQuery.data?.people ?? []
  const people = offeredPeople(allPeople)
  const addNew = useAddPerson()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const [caret, setCaret] = useState<number | undefined>(undefined)
  const [choice, setChoice] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [creating, setCreating] = useState<Typed | null>(null)

  const typed = caret === undefined ? null : mentionAt(value, caret)
  const mention = typed && typed.start !== dismissed ? typed : null
  const shownMention = mention ?? (addNew.isPending ? creating : null)
  const items = menuItems(
    shownMention && peopleQuery.data ? mentionItems(people, allPeople, shownMention.query) : [],
    mention !== null,
  )
  const open = shownMention !== null && items.length > 0

  const readCaret = () => setCaret(textareaRef.current?.selectionStart ?? undefined)

  const insert = (person: Person, start: number, cursor: number, text: string) => {
    const next = insertMention(text, start, cursor, person.name)
    onMention(next.text, person)
    setCaret(undefined)
    setChoice(0)
    setNavigated(false)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const create = (name: string, at: Typed, cursor: number, text: string) => {
    if (addNew.isPending) return
    setCreating(at)
    addNew.mutate(name, {
      onSettled: () => setCreating(null),
      onSuccess: (person) => {
        if (!person) return
        const latest = valueRef.current
        if (latest === text) insert(person, at.start, cursor, latest)
        else onMention(latest, person)
      },
    })
  }

  const pick = (item: MentionItem<Person>) => {
    if (!mention) return
    const cursor = textareaRef.current?.selectionStart ?? caret ?? value.length
    if (item.kind === 'person') insert(item.person, mention.start, cursor, value)
    else create(item.name, mention, cursor, value)
  }

  const keys = (e: KeyboardEvent) => {
    if (!mention || items.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setChoice(moveChoice(choice, e.key === 'ArrowDown' ? 1 : -1, items.length))
      setNavigated(true)
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
      const item = items[Math.min(choice, items.length - 1)]!
      if (!keyPicks(item, navigated)) return
      e.preventDefault()
      pick(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(mention.start)
    }
  }

  const placement = useMentionPlacement(open ? shownMention?.start : undefined, value, items.length, {
    menuRef,
    textareaRef,
    wrapRef,
  })

  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when first shown
  }, [])

  useEffect(() => {
    if (open) menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, choice])

  return (
    <div class="journal-mention-wrap" ref={wrapRef}>
      <MarkdownEditor
        value={value}
        onChange={(content) => {
          onChange(content)
          readCaret()
          setChoice(0)
          setNavigated(false)
        }}
        placeholder="Write what happened, what you thought, how it felt…"
        rows={10}
        autoGrow
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
      {open && (
        <MentionMenu
          items={items}
          active={highlighted(items, choice, navigated)}
          onPick={pick}
          pending={addNew.isPending}
          menuRef={menuRef}
          style={menuStyle(placement)}
        />
      )}
      {addNew.error && (
        <p class="journal-error" role="alert">
          {addNew.error.message}
        </p>
      )}
    </div>
  )
}
