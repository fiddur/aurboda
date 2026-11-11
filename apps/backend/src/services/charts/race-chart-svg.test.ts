import type { QuantChallengeDocument, QuantStandings, QuantStandingsMember } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  buildRaceChartSvg,
  formatChartDate,
  type RaceChartSvgData,
  raceChartDataFor,
  raceLinesFromStandings,
  raceMemberColor,
} from './race-chart-svg.ts'

const START = '2026-11-01T00:00:00.000Z'
const END = '2026-11-08T00:00:00.000Z'
const DAY = 86_400

const challenge = (over: Partial<QuantChallengeDocument> = {}): QuantChallengeDocument => ({
  bucket: '1d',
  endTime: END,
  host: { actor: null, name: 'fiddur', url: 'https://aurboda.example/u/fiddur' },
  joinMode: 'free',
  kind: 'challenge',
  metric: 'steps',
  name: 'November steps',
  scoring: 'sum',
  startTime: START,
  timezone: 'Europe/Stockholm',
  url: 'https://aurboda.example/u/fiddur/c/november',
  ...over,
})

const member = (name: string, samples: QuantStandingsMember['samples']): QuantStandingsMember => ({
  lastUpdated: null,
  name,
  rank: 1,
  samples,
  stale: false,
  total: 0,
  url: `https://aurboda.example/u/${name}`,
})

const standings = (members: QuantStandingsMember[]): QuantStandings => ({
  asOf: '2026-11-03T12:00:00.000Z',
  bucket: '1d',
  challenge: 'https://aurboda.example/u/fiddur/c/november',
  kind: 'standings',
  members,
})

const data = (over: Partial<RaceChartSvgData> = {}): RaceChartSvgData => ({
  asOf: new Date('2026-11-03T12:00:00.000Z'),
  endTime: new Date(END),
  lines: [
    {
      color: '#8b5cf6',
      name: 'alice',
      points: [
        [new Date(START), 0],
        [new Date('2026-11-02T00:00:00.000Z'), 10_000],
        [new Date('2026-11-03T00:00:00.000Z'), 18_000],
      ],
    },
    {
      color: '#10b981',
      name: 'bob',
      points: [
        [new Date(START), 0],
        [new Date('2026-11-02T00:00:00.000Z'), 6_000],
      ],
    },
  ],
  startTime: new Date(START),
  timezone: 'Europe/Stockholm',
  title: 'November steps',
  ...over,
})

describe('raceLinesFromStandings', () => {
  test('a running sum from the start line, each sample at its bucket end, colours by member index', () => {
    const lines = raceLinesFromStandings(
      challenge(),
      standings([
        member('alice', [
          { offset: DAY, sum: 5 },
          { offset: 0, sum: 10 },
        ]),
        member('bob', [{ offset: 0, sum: 3 }]),
      ]),
    )
    expect(lines.map((l) => l.name)).toEqual(['alice', 'bob'])
    expect(lines.map((l) => l.color)).toEqual(['#2b9ea7', '#10b981'])
    expect(lines[0].points).toEqual([
      [new Date(START), 0],
      [new Date('2026-11-02T00:00:00.000Z'), 10],
      [new Date('2026-11-03T00:00:00.000Z'), 15],
    ])
  })

  test('max scoring takes the running best', () => {
    const lines = raceLinesFromStandings(
      challenge({ scoring: 'max' }),
      standings([
        member('alice', [
          { max: 20, offset: 0 },
          { max: 12, offset: DAY },
          { max: 25, offset: 2 * DAY },
        ]),
      ]),
    )
    expect(lines[0].points.map(([, v]) => v)).toEqual([0, 20, 20, 25])
  })

  test('a member with no samples is dropped, keeping the others their leaderboard colour', () => {
    const lines = raceLinesFromStandings(
      challenge(),
      standings([member('idle', []), member('bob', [{ offset: 0, sum: 3 }])]),
    )
    expect(lines.map((l) => [l.name, l.color])).toEqual([['bob', '#10b981']])
  })

  test('an unparsable start time yields no lines', () => {
    expect(
      raceLinesFromStandings(
        challenge({ startTime: 'not a date' }),
        standings([member('a', [{ offset: 0, sum: 1 }])]),
      ),
    ).toEqual([])
  })

  test('colours past the palette go lighter, like the web', () => {
    expect(raceMemberColor(0)).toBe('#2b9ea7')
    expect(raceMemberColor(8)).toBe('#75c0c6')
    expect(raceMemberColor(16)).toBe('#2b9ea7')
  })
})

describe('raceChartDataFor', () => {
  test('null without standings', () => {
    expect(raceChartDataFor({ challenge: challenge(), kind: 'challenge' })).toBeNull()
  })

  test('the challenge name, window, timezone and snapshot time', () => {
    const result = raceChartDataFor({
      challenge: challenge(),
      kind: 'challenge',
      standings: standings([member('alice', [{ offset: 0, sum: 1 }])]),
    })
    expect(result).toMatchObject({
      asOf: new Date('2026-11-03T12:00:00.000Z'),
      endTime: new Date(END),
      startTime: new Date(START),
      timezone: 'Europe/Stockholm',
      title: 'November steps',
    })
    expect(result?.lines).toHaveLength(1)
  })
})

describe('buildRaceChartSvg', () => {
  test('a well-formed SVG at the feed attachment size', () => {
    const svg = buildRaceChartSvg(data())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="0 0 1000 420"')
    expect(svg).toContain('fill="#0b0f19"')
  })

  test('one polyline per line, in member order and colour', () => {
    const svg = buildRaceChartSvg(data())
    const strokes = [...svg.matchAll(/<polyline [^>]*stroke="([^"]+)"/g)].map((m) => m[1])
    expect(strokes).toEqual(['#8b5cf6', '#10b981'])
    const first = /<polyline points="([^"]+)"/.exec(svg)?.[1].split(' ')
    expect(first).toHaveLength(3)
  })

  test('a line with fewer than two points is not drawn', () => {
    const svg = buildRaceChartSvg(
      data({ lines: [{ color: '#8b5cf6', name: 'solo', points: [[new Date(START), 0]] }] }),
    )
    expect(svg).not.toContain('<polyline')
  })

  test('no lines still renders a valid SVG with the title', () => {
    const svg = buildRaceChartSvg(data({ lines: [] }))
    expect(svg).not.toContain('<polyline')
    expect(svg).toContain('>November steps</text>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  test('the title and legend names are escaped', () => {
    const svg = buildRaceChartSvg(
      data({
        lines: [
          {
            color: '#8b5cf6',
            name: '<b>&co</b>',
            points: [
              [new Date(START), 0],
              [new Date(END), 1],
            ],
          },
        ],
        title: 'Steps & <stuff>',
      }),
    )
    expect(svg).toContain('Steps &amp; &lt;stuff&gt;')
    expect(svg).toContain('&lt;b&gt;&amp;co&lt;/b&gt;')
    expect(svg).not.toContain('<b>')
  })

  test('the legend lists the first eight members and counts the rest', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      color: raceMemberColor(i),
      name: `member${i}`,
      points: [
        [new Date(START), 0],
        [new Date(END), i + 1],
      ] as [Date, number][],
    }))
    const svg = buildRaceChartSvg(data({ lines }))
    expect(svg).toContain('>member7</text>')
    expect(svg).not.toContain('>member8</text>')
    expect(svg).toContain('+2 more')
    expect([...svg.matchAll(/<polyline /g)]).toHaveLength(10)
  })

  test('labels 0 and the max total, the window dates and the snapshot time', () => {
    const svg = buildRaceChartSvg(data())
    expect(svg).toContain('>0</text>')
    expect(svg).toContain('>18,000</text>')
    expect(svg).toContain('>Nov 1, 2026</text>')
    expect(svg).toContain('>Nov 8, 2026</text>')
    expect(svg).toContain('as of Nov 3, 2026, 13:00')
  })
})

describe('buildRaceChartSvg bare', () => {
  test('draws the lines across the whole frame with no text, legend or background', () => {
    const svg = buildRaceChartSvg(data(), { bare: true, height: 100, width: 400 })
    expect(svg).toContain('viewBox="0 0 400 100"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<rect')
    expect([...svg.matchAll(/<polyline /g)]).toHaveLength(data().lines.length)
    expect(svg).toContain('<line x1="6" y1="94" x2="394" y2="94"') // baseline at the bare inset
    const first = /<polyline points="([^"]+)"/.exec(svg)?.[1].split(' ')[0]
    expect(first).toBe('6.0,94.0') // the start line at 0, bottom-left
  })
})

describe('formatChartDate', () => {
  test('formats in the challenge timezone', () => {
    expect(formatChartDate(new Date('2026-10-31T23:30:00Z'), 'Europe/Stockholm')).toBe('Nov 1, 2026')
    expect(formatChartDate(new Date('2026-10-31T23:30:00Z'), 'UTC')).toBe('Oct 31, 2026')
  })

  test('an unknown timezone falls back to UTC rather than throwing', () => {
    expect(formatChartDate(new Date('2026-10-31T23:30:00Z'), 'Not/AZone')).toBe('Oct 31, 2026')
  })
})
