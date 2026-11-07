import { extractHashtags, findHashtags, normalizeTags, toTag } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import {
  activityKindTag,
  articleTexts,
  autoPostTags,
  computePostTags,
  editedPostTags,
  exerciseKindTag,
  loadEditedPostTags,
  resolvePostTags,
  retagPost,
} from './post-tags.ts'

describe('extractHashtags', () => {
  test('finds tags at the start, after whitespace and after punctuation', () => {
    expect(extractHashtags('#Running in the rain, (#wet) and #cold!')).toEqual(['running', 'wet', 'cold'])
  })

  test('dedupes case-insensitively, keeping first-seen order', () => {
    expect(extractHashtags('#Run #run #RUN #b')).toEqual(['run', 'b'])
  })

  test('ignores a # inside a word or a URL fragment', () => {
    expect(extractHashtags('issue#12 C#sharp see example.com/#x and https://x.org/a?b=#c')).toEqual([])
  })

  test('ignores markdown code spans and fences', () => {
    expect(extractHashtags('`#notatag` and\n```\n#nope\n```\n#yes')).toEqual(['yes'])
  })

  test('allows unicode letters and underscores, rejects digits-only', () => {
    expect(extractHashtags('#löpning #2026 #run_club #5k')).toEqual(['löpning', 'run_club', '5k'])
  })

  test('normalises decomposed accents to the composed tag', () => {
    expect(extractHashtags('#löpning')).toEqual(['löpning'])
  })

  test('rejects a tag longer than 64 characters', () => {
    expect(extractHashtags(`#${'a'.repeat(65)} #ok`)).toEqual(['ok'])
  })

  test('findHashtags keeps the written casing and the index of the #', () => {
    expect(findHashtags('go #Run')).toEqual([{ index: 3, tag: 'run', text: 'Run' }])
  })
})

describe('toTag', () => {
  test('keeps only letters and digits, lowercase', () => {
    expect(toTag('strength_training')).toBe('strengthtraining')
    expect(toTag('Dumbbell Bench Press')).toBe('dumbbellbenchpress')
    expect(toTag('Löpning')).toBe('löpning')
  })

  test('is null for nothing usable', () => {
    expect(toTag('—')).toBeNull()
    expect(toTag('')).toBeNull()
    expect(toTag('123')).toBeNull()
  })
})

describe('normalizeTags', () => {
  test('lowercases, strips #, drops invalid, dedupes and caps at 10', () => {
    expect(normalizeTags(['#Aurboda', 'aurboda', 'not valid', '', '42', 'Run'])).toEqual(['aurboda', 'run'])
    expect(normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(10)
  })
})

describe('autoPostTags', () => {
  test('defaults to #aurboda plus the kind tag', () => {
    expect(autoPostTags(null, 'running')).toEqual(['aurboda', 'running'])
  })

  test('follows the settings: own default tags, type tag off', () => {
    expect(autoPostTags({ feed_default_tags: ['qs'], feed_type_tag: false }, 'running')).toEqual(['qs'])
    expect(autoPostTags({ feed_default_tags: [] }, null)).toEqual([])
  })

  test("an auto-share rule's tags replace the defaults but keep the type tag", () => {
    expect(autoPostTags({ feed_default_tags: ['qs'] }, 'running', ['mytag'])).toEqual(['mytag', 'running'])
    expect(autoPostTags({ feed_type_tag: false }, 'running', ['mytag'])).toEqual(['mytag'])
    expect(autoPostTags({ feed_default_tags: ['qs'] }, 'running', null)).toEqual(['qs', 'running'])
  })
})

describe('computePostTags', () => {
  test('auto tags plus typed ones', () => {
    expect(computePostTags({ auto: ['aurboda', 'running'], texts: ['Easy #Zone2 run', null] })).toEqual([
      'aurboda',
      'running',
      'zone2',
    ])
  })

  test('explicit tags replace the auto ones; typed are still added', () => {
    expect(computePostTags({ auto: ['aurboda'], explicit: ['#Mine'], texts: ['#typed'] })).toEqual([
      'mine',
      'typed',
    ])
    expect(computePostTags({ auto: ['aurboda'], explicit: [], texts: [] })).toEqual([])
  })
})

describe('retagPost', () => {
  test('an unchanged text keeps the stored tags', () => {
    expect(retagPost({ before: ['#a'], stored: ['x', 'a'] })).toEqual(['x', 'a'])
  })

  test('a changed text swaps the typed tags, keeping the others', () => {
    expect(retagPost({ after: ['now #b'], before: ['was #a'], stored: ['x', 'a'] })).toEqual(['x', 'b'])
  })

  test('explicit tags replace, plus those typed in the new (or unchanged) text', () => {
    expect(retagPost({ before: ['#a'], explicit: ['y'], stored: ['x', 'a'] })).toEqual(['y', 'a'])
    expect(retagPost({ after: ['#b'], before: ['#a'], explicit: [], stored: ['x', 'a'] })).toEqual(['b'])
  })
})

describe('editedPostTags', () => {
  test('undefined when neither tags nor message change', () => {
    expect(editedPostTags({ message: 'hi', tags: ['aurboda'] }, {})).toBeUndefined()
  })

  test('a cleared message drops its typed tags', () => {
    expect(editedPostTags({ message: 'hi #x', tags: ['aurboda', 'x'] }, { message: null })).toEqual([
      'aurboda',
    ])
  })
})

describe('loadEditedPostTags', () => {
  const post = { message: 'hi #x', tags: ['aurboda', 'x'] }

  test('does not load the post when the edit leaves the tags', async () => {
    const getPost = vi.fn(async () => post)
    expect(await loadEditedPostTags('u', 'p', {}, getPost)).toEqual({ found: true, tags: undefined })
    expect(getPost).not.toHaveBeenCalled()
  })

  test('retags from the stored post, or reports it missing', async () => {
    expect(await loadEditedPostTags('u', 'p', { message: 'now #y' }, async () => post)).toEqual({
      found: true,
      tags: ['aurboda', 'y'],
    })
    expect(await loadEditedPostTags('u', 'p', { tags: ['z'] }, async () => null)).toEqual({ found: false })
  })
})

describe('kind tags', () => {
  test('activity: its type key; exercise: its name, else its value', () => {
    expect(activityKindTag('strength_training')).toBe('strengthtraining')
    expect(exerciseKindTag({ name: 'Dumbbell Bench Press', value: 'db_bench' })).toBe('dumbbellbenchpress')
    expect(exerciseKindTag({ name: '—', value: 'Squat' })).toBe('squat')
  })
})

describe('articleTexts', () => {
  test('title and prose blocks only', () => {
    expect(
      articleTexts({
        blocks: [
          { markdown: 'Body #x', type: 'prose' },
          { metric: 'weight', type: 'chart' },
        ],
        title: 'Title #t',
      }),
    ).toEqual(['Title #t', 'Body #x'])
  })
})

describe('resolvePostTags', () => {
  const settings = async () => ({ feed_default_tags: ['qs'], feed_type_tag: true })

  test('loads the settings for the automatic tags', async () => {
    expect(await resolvePostTags('u', { kindTag: 'running', texts: ['#fun'] }, settings)).toEqual([
      'qs',
      'running',
      'fun',
    ])
  })

  test('a reply gets only typed tags, without loading settings', async () => {
    const load = vi.fn(settings)
    expect(await resolvePostTags('u', { reply: true, texts: ['nice #run'] }, load)).toEqual(['run'])
    expect(load).not.toHaveBeenCalled()
  })

  test('explicit tags skip the settings', async () => {
    const load = vi.fn(settings)
    expect(await resolvePostTags('u', { explicit: ['x'], kindTag: 'running', texts: [] }, load)).toEqual([
      'x',
    ])
    expect(load).not.toHaveBeenCalled()
  })

  test('unreadable settings fall back to the defaults', async () => {
    const failing = async () => {
      throw new Error('db down')
    }
    expect(await resolvePostTags('u', { kindTag: 'challenge', texts: [] }, failing)).toEqual([
      'aurboda',
      'challenge',
    ])
  })
})
