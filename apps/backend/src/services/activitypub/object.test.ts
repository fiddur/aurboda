import { describe, expect, test } from 'vitest'

import { addressingFor, AS_PUBLIC, feedPostContent, formatActivityWindow } from './object.ts'

describe('addressingFor', () => {
  const followers = 'https://aurboda.net/u/fredrik/followers'
  test('public → Public in to, followers in cc', () => {
    expect(addressingFor('public', followers)).toEqual({ cc: [followers], to: [AS_PUBLIC] })
  })
  test('unlisted → followers in to, Public in cc', () => {
    expect(addressingFor('unlisted', followers)).toEqual({ cc: [AS_PUBLIC], to: [followers] })
  })
  test('followers → followers only, no Public anywhere', () => {
    expect(addressingFor('followers', followers)).toEqual({ cc: [], to: [followers] })
  })
})

describe('formatActivityWindow', () => {
  test('same-day window collapses the end to its time', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', '2026-08-02T16:12:00Z', 'Europe/Stockholm')).toBe(
      'Sun, 2 Aug 2026, 15:44–18:12',
    )
  })

  test('cross-day window spells out both ends', () => {
    expect(formatActivityWindow('2026-08-02T22:30:00Z', '2026-08-03T06:10:00Z', 'UTC')).toBe(
      'Sun, 2 Aug 2026, 22:30 – Mon, 3 Aug 2026, 06:10',
    )
  })

  test('open-ended activity renders only the start', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', undefined, 'UTC')).toBe('Sun, 2 Aug 2026, 13:44')
  })

  test('an invalid timezone falls back to UTC instead of throwing', () => {
    expect(formatActivityWindow('2026-08-02T13:44:00Z', undefined, 'Not/AZone')).toBe(
      'Sun, 2 Aug 2026, 13:44',
    )
  })
})

describe('feedPostContent', () => {
  test('renders a bold headline with one stat per line and a humanized duration', () => {
    const { content } = feedPostContent('Evening qigong', 'yoga', [
      { key: 'duration', label: 'Duration', unit: 'seconds', value: 642 },
      { key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 76 },
      { key: 'calories', label: 'Calories', unit: 'kcal', value: 9 },
    ])
    expect(content).toBe(
      '<p><strong>Evening qigong</strong></p><p>Duration 10m 42s<br>Avg HR 76 bpm<br>Calories 9 kcal</p>',
    )
  })

  test('a personal message renders between the headline and the date line', () => {
    const { content } = feedPostContent(
      'Morning run',
      'running',
      [{ key: 'distance', label: 'Distance', unit: 'km', value: 8.2 }],
      { message: 'Felt great,\nnegative splits!', windowLabel: 'Wed, 1 Jul 2026, 06:30–07:11' },
    )
    expect(content).toBe(
      '<p><strong>Morning run</strong></p>' +
        '<p>Felt great,<br>negative splits!</p>' +
        '<p>Wed, 1 Jul 2026, 06:30–07:11</p>' +
        '<p>Distance 8.2 km</p>',
    )
  })

  test('a blank message renders no message paragraph', () => {
    const { content } = feedPostContent('Row', 'rowing', [], { message: '   ' })
    expect(content).toBe('<p><strong>Row</strong></p>')
  })

  test('escapes HTML in the message and preserves its linebreaks as <br>', () => {
    const { content } = feedPostContent('Row', 'rowing', [], {
      message: 'So <b>good</b>\n& calm',
      windowLabel: 'Sun, 2 Aug 2026, 15:44–18:12',
    })
    expect(content).toBe(
      '<p><strong>Row</strong></p>' +
        '<p>So &lt;b&gt;good&lt;/b&gt;<br>&amp; calm</p>' +
        '<p>Sun, 2 Aug 2026, 15:44–18:12</p>',
    )
  })

  test('escapes HTML in the title for the fallback content', () => {
    const { content } = feedPostContent('Run <b>x</b> & "go"', 'running', [])
    expect(content).toBe('<p><strong>Run &lt;b&gt;x&lt;/b&gt; &amp; &quot;go&quot;</strong></p>')
  })

  test('renders hours and minutes for a long duration', () => {
    const { content } = feedPostContent('Long ride', 'cycling', [
      { key: 'duration', label: 'Duration', unit: 'seconds', value: 3720 },
    ])
    expect(content).toBe('<p><strong>Long ride</strong></p><p>Duration 1h 2m</p>')
  })

  test('untitled activity gets a type-derived headline and no stats line when nothing is shared', () => {
    const { content, name } = feedPostContent(undefined, 'yoga', [])
    expect(content).toBe('<p><strong>Yoga activity</strong></p>')
    expect(name).toBe('Yoga activity')
  })
})
