import type { Note } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { buildCommentItems, commentLabel, COMMENT_LABEL_MAX, stripMarkdown } from './commentItems'

const note = (overrides: Partial<Note> = {}): Note => ({
  content: 'Felt dizzy right after this',
  created_at: '2026-09-13T08:30:00.000Z',
  entity_type: 'time',
  id: '11111111-1111-1111-1111-111111111111',
  start_time: '2026-09-13T08:00:00.000Z',
  ...overrides,
})

describe('stripMarkdown', () => {
  it('drops heading, quote and list markers', () => {
    expect(stripMarkdown('## Felt dizzy')).toBe('Felt dizzy')
    expect(stripMarkdown('> quoted')).toBe('quoted')
    expect(stripMarkdown('- bullet')).toBe('bullet')
    expect(stripMarkdown('3. numbered')).toBe('numbered')
  })

  it('unwraps emphasis, code and links', () => {
    expect(stripMarkdown('**bold** and _italic_ and `code`')).toBe('bold and italic and code')
    expect(stripMarkdown('see [the run](/detail/activity/42)')).toBe('see the run')
    expect(stripMarkdown('![a photo](/img.png)')).toBe('a photo')
  })
})

describe('commentLabel', () => {
  it('takes the first non-empty line, markdown stripped', () => {
    expect(commentLabel('\n\n## Felt dizzy\n\nafter the run')).toBe('Felt dizzy')
  })

  it('truncates to the label budget', () => {
    const label = commentLabel('x'.repeat(200))
    expect(label).toHaveLength(COMMENT_LABEL_MAX)
    expect(label.endsWith('…')).toBe(true)
  })

  it('is empty for an empty comment', () => {
    expect(commentLabel('')).toBe('')
  })
})

describe('buildCommentItems', () => {
  it('returns nothing for an empty list', () => {
    expect(buildCommentItems([])).toEqual([])
  })

  it('maps a thread root anchored to a moment', () => {
    const [item] = buildCommentItems([note()])
    expect(item?.column).toBe('Comments')
    expect(item?.comment_id).toBe('11111111-1111-1111-1111-111111111111')
    expect(item?.icon).toBe('💬')
    expect(item?.label).toBe('Felt dizzy right after this')
    expect(item?.tooltip.time).toBe('08:00')
    expect(item?.start.toISOString()).toBe('2026-09-13T08:00:00.000Z')
  })

  it('is a point without an end_time and a span with one', () => {
    const [point] = buildCommentItems([note()])
    expect(point?.isPoint).toBe(true)
    expect(point?.end.getTime()).toBe(point?.start.getTime())

    const [span] = buildCommentItems([note({ end_time: '2026-09-13T09:30:00.000Z' })])
    expect(span?.isPoint).toBe(false)
    expect(span?.end.toISOString()).toBe('2026-09-13T09:30:00.000Z')
  })

  it('puts the reply count in the tooltip, pluralised', () => {
    const one = buildCommentItems([note({ replies: [{ content: 'still dizzy' }] })])
    expect(one[0]?.tooltip.details[0]).toBe('1 reply')

    const two = buildCommentItems([note({ replies: [{ content: 'a' }, { content: 'b' }] })])
    expect(two[0]?.tooltip.details[0]).toBe('2 replies')

    const none = buildCommentItems([note()])
    expect(none[0]?.tooltip.details).toEqual(['Felt dizzy right after this'])
  })

  it('shows the first two content lines in the tooltip', () => {
    const [item] = buildCommentItems([note({ content: 'one\ntwo\nthree' })])
    expect(item?.tooltip.details).toEqual(['one', 'two'])
  })

  it('skips roots with no start_time or no id', () => {
    expect(buildCommentItems([note({ start_time: undefined })])).toEqual([])
    expect(buildCommentItems([note({ id: undefined })])).toEqual([])
  })

  it('maps a comment anchored to an entity just like one on a moment', () => {
    const [item] = buildCommentItems([
      note({ entity_id: 'activity-1', entity_type: 'activity', start_time: '2026-09-13T06:15:00.000Z' }),
    ])
    expect(item?.column).toBe('Comments')
    expect(item?.tooltip.time).toBe('06:15')
    // No entity link on the bubble itself — the panel is what leads back.
    expect(item?.entity_id).toBeUndefined()
    expect(item?.href).toBeUndefined()
  })
})
