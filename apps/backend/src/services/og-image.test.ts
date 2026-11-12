import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { generateIdenticon } from './avatar.ts'
import { challengeTheme } from './og-challenge-theme.ts'
import {
  challengeCallToAction,
  clampTitle,
  createOgImageRenderer,
  eyebrowOf,
  OG_HEIGHT,
  OG_WIDTH,
  type OgCard,
  type OgChallengeMember,
  sparklineSvg,
  twemojiFileCandidates,
  twemojiFileName,
} from './og-image.ts'

const renderOgImage = createOgImageRenderer()

const graphemeCount = (text: string): number =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length

const hasLeafOrangePixel = async (png: Buffer): Promise<boolean> => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (r > 180 && g > 60 && g < 170 && b < 90) return true
  }
  return false
}

const stepsCard = (
  members: OgChallengeMember[],
  status: 'ongoing' | 'upcoming',
  bannerDataUri?: string,
): OgCard => ({
  challenge: {
    bannerDataUri,
    joined: members.length,
    measure: 'Steps',
    members,
    phrase: status === 'upcoming' ? 'Starts in 3 days' : 'Ends in 12 days',
    range: '1 Oct – 31 Oct 2026',
    status,
    theme: challengeTheme({ pattern: 'steps', source_type: 'metric' }),
    unit: 'steps',
  },
  kind: 'challenge',
  title: 'October steps',
  username: 'fiddur',
})

describe('challengeCallToAction', () => {
  const host = { name: 'fiddur', total: null }
  const other = { name: 'anna', total: null }

  test('invites the first joiner while only the host is in', () => {
    expect(challengeCallToAction({ joined: 0, members: [host], status: 'upcoming' })).toEqual({
      headline: 'Be the first to join',
      invite: true,
    })
  })

  test('counts who joined besides the host', () => {
    expect(challengeCallToAction({ joined: 2, members: [host, other, other], status: 'ongoing' })).toEqual({
      headline: '2 joined',
      invite: true,
    })
  })

  test('an ended challenge says who took part, without a join prompt', () => {
    expect(challengeCallToAction({ joined: 1, members: [host, other], status: 'ended' })).toEqual({
      headline: '2 took part',
      invite: false,
    })
  })

  test('an ended challenge with no members says nothing', () => {
    expect(challengeCallToAction({ joined: 0, members: [], status: 'ended' })).toBeNull()
  })
})

describe('clampTitle', () => {
  test('leaves short titles untouched', () => {
    expect(clampTitle('Training')).toBe('Training')
  })

  test('truncates long titles with an ellipsis', () => {
    const clamped = clampTitle('x'.repeat(120))
    expect(clamped.length).toBeLessThanOrEqual(60)
    expect(clamped.endsWith('…')).toBe(true)
  })

  test('never splits an emoji when truncating', () => {
    const clamped = clampTitle('🍂'.repeat(70))
    expect(clamped.endsWith('…')).toBe(true)
    expect(clamped.isWellFormed()).toBe(true)
    expect(graphemeCount(clamped)).toBeLessThanOrEqual(60)
  })
})

const polylinePoints = (svg: string): [number, number][] =>
  (/points="([^"]*)"/.exec(svg)?.[1] ?? '')
    .split(' ')
    .map((pair) => pair.split(',').map(Number) as [number, number])

describe('sparklineSvg', () => {
  test('draws one point per value, evenly spread inside the box', () => {
    const svg = sparklineSvg([1, 3, 2, 5], 460, 170)
    expect(svg).toContain('width="460" height="170" viewBox="0 0 460 170"')
    const points = polylinePoints(svg)
    expect(points).toHaveLength(4)
    const xs = points.map(([x]) => x)
    expect(xs[1] - xs[0]).toBeCloseTo(xs[3] - xs[2], 1)
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(460)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(170)
    }
  })

  test('puts the highest value at the top and the lowest at the bottom', () => {
    const [low, high] = polylinePoints(sparklineSvg([1, 5], 460, 170))
    expect(high[1]).toBeLessThan(low[1])
    expect(high[1]).toBeLessThan(170 / 2)
    expect(low[1]).toBeGreaterThan(170 / 2)
  })

  test('draws a flat series at mid-height', () => {
    for (const [, y] of polylinePoints(sparklineSvg([4, 4, 4], 460, 170))) expect(y).toBe(85)
  })
})

describe('twemojiFileName', () => {
  test.each([
    ['🍂', '1f342'],
    ['❤️', '2764'],
    ['🏃‍♀️', '1f3c3-200d-2640-fe0f'],
    ['🇸🇪', '1f1f8-1f1ea'],
    ['👍🏽', '1f44d-1f3fd'],
  ])('%s → %s', (emoji, fileName) => {
    expect(twemojiFileName(emoji)).toBe(fileName)
  })
})

describe('twemojiFileCandidates', () => {
  test('falls back to the name without fe0f for ZWJ sequences', () => {
    expect(twemojiFileCandidates('👁️‍🗨️')).toEqual(['1f441-fe0f-200d-1f5e8-fe0f', '1f441-200d-1f5e8'])
  })

  test('has a single candidate when nothing can be stripped', () => {
    expect(twemojiFileCandidates('🍂')).toEqual(['1f342'])
  })
})

describe('eyebrowOf', () => {
  test('labels a card by its kind, or by the eyebrow it carries', () => {
    expect(eyebrowOf({ kind: 'dashboard', title: 'x' })).toBe('Dashboard')
    expect(eyebrowOf({ kind: 'post', title: 'x' })).toBe('Post')
    expect(eyebrowOf({ eyebrow: 'Activity', kind: 'post', title: 'x' })).toBe('Activity')
  })
})

describe('renderOgImage', () => {
  test('renders a 1200x630 PNG for a dashboard card', async () => {
    const png = await renderOgImage({ kind: 'dashboard', title: 'Training & effect' })
    // PNG magic bytes.
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47')
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(OG_WIDTH)
    expect(meta.height).toBe(OG_HEIGHT)
  })

  test('renders a post card with an eyebrow and a subtitle at 1200x630', async () => {
    const png = await renderOgImage({
      eyebrow: 'Activity',
      kind: 'post',
      subtitle: 'Morning run Distance: 5.2 km Duration: 30m Average heart rate: 142 bpm …',
      title: 'A fairly long morning run along the river and back',
      username: 'fiddur',
    })
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(OG_WIDTH)
    expect(meta.height).toBe(OG_HEIGHT)
  })

  test('renders profile and challenge cards without throwing', async () => {
    await expect(renderOgImage({ kind: 'profile', title: 'fiddur' })).resolves.toBeInstanceOf(Buffer)
    await expect(
      renderOgImage({ kind: 'challenge', subtitle: 'federated', title: 'Step count' }),
    ).resolves.toBeInstanceOf(Buffer)
  })

  test('embeds a PNG avatar data URI without throwing (Satori decodes PNG)', async () => {
    const { data } = await generateIdenticon('fiddur')
    const avatarDataUri = `data:image/png;base64,${data.toString('base64')}`
    const png = await renderOgImage({ avatarDataUri, kind: 'profile', title: 'fiddur' })
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47')
  })

  test('draws emoji from Twemoji instead of tofu', async () => {
    const withEmoji = await renderOgImage({ kind: 'challenge', title: 'October steps 🍂 🏃' })
    const plain = await renderOgImage({ kind: 'challenge', title: 'October steps' })
    expect(await hasLeafOrangePixel(withEmoji)).toBe(true)
    expect(await hasLeafOrangePixel(plain)).toBe(false)
  })

  test('renders an emoji Twemoji does not have without throwing', async () => {
    await expect(renderOgImage({ kind: 'challenge', title: 'New 🫩' })).resolves.toBeInstanceOf(Buffer)
  })

  test('renders a challenge card with standings at 1200x630', async () => {
    const png = await renderOgImage(
      stepsCard(
        [
          { name: 'Fredrik', total: 123456 },
          { name: 'Anna', total: 98765 },
          { name: 'Bo', total: 45000 },
        ],
        'ongoing',
      ),
    )
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(OG_WIDTH)
    expect(meta.height).toBe(OG_HEIGHT)
  })

  test('renders an exercise card at 1200x630', async () => {
    const exerciseCard = (exercise: OgCard['exercise']): OgCard => ({
      exercise,
      kind: 'exercise',
      title: 'Dumbbell Bench Press',
      username: 'fiddur',
    })
    const headline = { date: '21 Dec 2025', label: 'Best e1RM', value: '39.5 kg' }
    const sessions = '43 sessions since Mar 2025'
    for (const card of [
      exerciseCard({
        activityTypeName: 'Strength training',
        headline,
        sessions,
        sparkline: [30, 34, 39.5, 39],
      }),
      exerciseCard({ activityTypeName: 'Strength training', headline, sessions, sparkline: [] }),
      exerciseCard({ activityTypeName: 'Running', sessions: '1 session, 4 Nov 2026', sparkline: [] }),
      exerciseCard({ activityTypeName: 'Running', sparkline: [] }),
    ]) {
      const meta = await sharp(await renderOgImage(card)).metadata()
      expect(meta.width).toBe(OG_WIDTH)
      expect(meta.height).toBe(OG_HEIGHT)
    }
  })

  test('draws the exercise sparkline', async () => {
    const card = (sparkline: number[]): OgCard => ({
      exercise: { activityTypeName: 'Strength training', sessions: '43 sessions since Mar 2025', sparkline },
      kind: 'exercise',
      title: 'Bench',
    })
    const brightPixels = async (png: Buffer): Promise<number> => {
      const { data, info } = await sharp(png)
        .extract({ height: 200, left: 660, top: 230, width: 460 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      let count = 0
      for (let i = 0; i < data.length; i += info.channels) if (data[i + 1] > 200) count++
      return count
    }
    const without = await brightPixels(await renderOgImage(card([])))
    const withLine = await brightPixels(await renderOgImage(card([1, 2, 3, 4])))
    expect(without).toBe(0)
    expect(withLine).toBeGreaterThan(100)
  })

  test('renders an upcoming challenge nobody has joined yet', async () => {
    await expect(renderOgImage(stepsCard([], 'upcoming'))).resolves.toBeInstanceOf(Buffer)
  })

  test('paints the challenge in its theme gradient', async () => {
    const png = await renderOgImage(stepsCard([], 'upcoming'))
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const offset = (10 * info.width + 10) * info.channels
    const [r, g] = [data[offset], data[offset + 1]]
    expect(g).toBeGreaterThan(r)
  })

  test('draws a host-set banner full-bleed under a darkening overlay instead of the theme', async () => {
    const jpeg = await sharp({
      create: { background: { b: 0, g: 140, r: 255 }, channels: 3, height: OG_HEIGHT, width: OG_WIDTH },
    })
      .jpeg()
      .toBuffer()
    const png = await renderOgImage(
      stepsCard([], 'upcoming', `data:image/jpeg;base64,${jpeg.toString('base64')}`),
    )
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const [r, g, b] = data.subarray(0, 3)
    expect(r).toBeGreaterThan(150)
    expect(r).toBeLessThan(230)
    expect(g).toBeLessThan(r)
    expect(b).toBeLessThan(40)
    expect(info.width).toBe(OG_WIDTH)
  })

  describe('a post card with a chart', () => {
    const start = Date.parse('2026-11-01T06:30:00Z')
    const series: [Date, number][] = Array.from({ length: 40 }, (_, i) => [
      new Date(start + i * 60_000),
      120 + 30 * Math.sin(i / 4),
    ])
    const postCard = (over: Partial<OgCard> = {}): OgCard => ({
      eyebrow: 'Activity',
      kind: 'post',
      subtitle: 'Felt great today',
      title: 'Morning run',
      username: 'fiddur',
      ...over,
    })
    const redPixels = async (png: Buffer): Promise<number> => {
      const { data, info } = await sharp(png)
        .extract({ height: 200, left: 80, top: 280, width: 1040 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      let count = 0
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] > 200 && data[i + 1] < 110 && data[i + 2] < 110) count++
      }
      return count
    }

    test('draws the line in the heart-rate red under the title, and nothing like it without one', async () => {
      expect(await redPixels(await renderOgImage(postCard()))).toBe(0)
      expect(
        await redPixels(await renderOgImage(postCard({ chart: { series, type: 'line' } }))),
      ).toBeGreaterThan(500)
    })

    test('renders every chart kind at 1200x630, with a short or a wrapping title', async () => {
      const race: OgCard['chart'] = {
        data: {
          asOf: new Date(start + 86_400_000),
          endTime: new Date(start + 7 * 86_400_000),
          lines: [
            { color: '#2b9ea7', name: 'Fredrik', points: [series[0], series[39]] },
            { color: '#10b981', name: 'Anna', points: [series[0], series[20]] },
          ],
          startTime: new Date(start),
          timezone: 'UTC',
          title: 'November steps',
        },
        type: 'race',
      }
      const scatter: OgCard['chart'] = {
        data: {
          group_comparison: null,
          n: 3,
          outcome: { kind: 'metric', metric: 'sleep_score' },
          pearson: 0.5,
          pearson_p: 0.1,
          series: [
            { outcome: 70, trigger: 1 },
            { outcome: 80, trigger: 2 },
            { outcome: 75, trigger: 3 },
          ],
          spearman: 0.5,
          trigger: { kind: 'metric', metric: 'steps' },
        },
        type: 'scatter',
      }
      for (const chart of [{ series, type: 'line' } as const, race, scatter]) {
        for (const title of ['Morning run', 'A fairly long morning run along the river and back again']) {
          const meta = await sharp(await renderOgImage(postCard({ chart, title }))).metadata()
          expect(meta.width).toBe(OG_WIDTH)
          expect(meta.height).toBe(OG_HEIGHT)
        }
      }
    })
  })

  describe('a dashboard card with a chart', () => {
    const start = Date.parse('2026-10-01T00:00:00Z')
    const series: [Date, number][] = Array.from({ length: 30 }, (_, i) => [
      new Date(start + i * 86_400_000),
      8000 + 2000 * Math.sin(i / 3),
    ])
    const dashboardCard = (over: Partial<OgCard> = {}): OgCard => ({
      kind: 'dashboard',
      title: 'Training',
      username: 'fiddur',
      ...over,
    })
    const tealPixels = async (png: Buffer): Promise<number> => {
      const { data, info } = await sharp(png)
        .extract({ height: 200, left: 80, top: 280, width: 1040 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      let count = 0
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] < 90 && data[i + 1] > 130 && data[i + 2] > 140 && data[i + 1] - data[i] > 80) count++
      }
      return count
    }

    test('draws the widget’s line under the title, and only the title card without one', async () => {
      const plain = await renderOgImage(dashboardCard())
      const charted = await renderOgImage(
        dashboardCard({ chart: { opts: { color: '#2b9ea7', label: 'Steps' }, series, type: 'line' } }),
      )
      expect(await tealPixels(plain)).toBe(0)
      expect(await tealPixels(charted)).toBeGreaterThan(500)
      const meta = await sharp(charted).metadata()
      expect(meta.width).toBe(OG_WIDTH)
      expect(meta.height).toBe(OG_HEIGHT)
    })
  })
})
