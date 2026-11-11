/**
 * Dynamic Open Graph preview images (1200×630 PNG) for public share pages.
 *
 * Satori renders a branded card (HTML/flexbox subset → SVG) and sharp
 * rasterizes it to PNG. Fonts are bundled (see assets/fonts/README.md) because
 * the production image has no system fonts; emoji are drawn from the bundled
 * Twemoji SVGs (`@twemoji/svg`). Everything is a pure function of the
 * passed-in card data — callers resolve visibility first and never render a
 * private resource.
 */
import type { ChallengeTimeStatus } from '@aurboda/api-spec'

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import satori, { type Font } from 'satori'
import sharp from 'sharp'

import type { OgExerciseDetails } from './exercise-card.ts'
import type { ChallengeTheme } from './og-challenge-theme.ts'

import { type PostChart, postChartCaption, postChartSvg } from './charts/post-chart-svg.ts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

export interface OgChallengeMember {
  name: string
  total: number | null
}

export interface OgChallengeDetails {
  theme: ChallengeTheme
  /** "Steps", "Running" — what is measured, for the eyebrow. */
  measure: string
  unit: string
  range: string
  phrase: string
  status: ChallengeTimeStatus
  /** Active members, host included, best total first; totals null while nothing has been fetched. */
  members: OgChallengeMember[]
  /** Members other than the host. */
  joined: number
  /** The host-set banner as a `data:` URI (JPEG/PNG — Satori cannot decode WebP), drawn behind the text. */
  bannerDataUri?: string
}

/** What the card should say. `kind` drives the small uppercase eyebrow label. */
export interface OgCard {
  kind: 'dashboard' | 'challenge' | 'exercise' | 'profile' | 'post'
  /** Replaces the eyebrow computed from `kind`, e.g. a post's own kind (`Activity`, `Article`). */
  eyebrow?: string
  title: string
  subtitle?: string
  /** Optional `data:` URI for the owner's avatar, shown next to the wordmark. */
  avatarDataUri?: string
  /** Who owns the resource, shown next to the wordmark as "@name". */
  username?: string
  challenge?: OgChallengeDetails
  exercise?: OgExerciseDetails
  /** A post's or a dashboard's chart, drawn under its title in place of the excerpt. */
  chart?: PostChart
}

const FONT_FAMILY = 'Liberation Sans'
const fontDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url))

/** A write-once memoizing font loader; kept in a closure to avoid module state. */
const createFontLoader = (): (() => Promise<Font[]>) => {
  let fontsPromise: Promise<Font[]> | null = null
  return () => {
    fontsPromise ??= Promise.all([
      readFile(`${fontDir}LiberationSans-Regular.ttf`),
      readFile(`${fontDir}LiberationSans-Bold.ttf`),
    ]).then(([regular, bold]): Font[] => [
      { data: regular, name: FONT_FAMILY, style: 'normal', weight: 400 },
      { data: bold, name: FONT_FAMILY, style: 'normal', weight: 700 },
    ])
    return fontsPromise
  }
}

/**
 * Twemoji file name for one emoji grapheme: its code points in lower-case hex,
 * joined with `-`. Twemoji drops the U+FE0F variation selector from the name
 * unless the sequence contains a zero-width joiner (U+200D).
 */
export const twemojiFileName = (segment: string): string => {
  const codePoints = Array.from(segment, (char) => char.codePointAt(0)!.toString(16))
  return (codePoints.includes('200d') ? codePoints : codePoints.filter((cp) => cp !== 'fe0f')).join('-')
}

/**
 * File names to try, in order. A few ZWJ sequences (👁️‍🗨️, for one) are named
 * without their `fe0f` even though the RGI sequence carries it, so the fully
 * stripped name is the fallback.
 */
export const twemojiFileCandidates = (segment: string): string[] => {
  const fileName = twemojiFileName(segment)
  const stripped = fileName.replaceAll('-fe0f', '')
  return stripped === fileName ? [fileName] : [fileName, stripped]
}

const createEmojiLoader = (): ((segment: string) => Promise<string | []>) => {
  const twemojiDir = dirname(createRequire(import.meta.url).resolve('@twemoji/svg/package.json'))
  const cache = new Map<string, Promise<string | undefined>>()
  const readSvg = async (candidates: string[]): Promise<string | undefined> => {
    for (const fileName of candidates) {
      try {
        const svg = await readFile(`${twemojiDir}/${fileName}.svg`)
        return `data:image/svg+xml;base64,${svg.toString('base64')}`
      } catch {
        continue
      }
    }
    return undefined
  }
  return async (segment) => {
    const candidates = twemojiFileCandidates(segment)
    return (await cache.getOrInsertComputed(candidates[0], () => readSvg(candidates))) ?? []
  }
}

const KIND_LABEL: Record<OgCard['kind'], string> = {
  challenge: 'Challenge',
  dashboard: 'Dashboard',
  exercise: 'Exercise',
  post: 'Post',
  profile: 'Profile',
}

// Minimal element factory — Satori accepts React-element-shaped plain objects,
// so we avoid a JSX/React runtime in the backend.
type El = { type: string; props: Record<string, unknown> }
const el = (type: string, style: Record<string, unknown>, children?: unknown): El => ({
  props: { children, style },
  type,
})

/** Decorative ring shown when there's no avatar. */
const ringBadge = (): El =>
  el(
    'div',
    {
      alignItems: 'center',
      border: '8px solid rgba(255,255,255,0.9)',
      borderRadius: '50%',
      display: 'flex',
      height: 72,
      justifyContent: 'center',
      width: 72,
    },
    el('div', {
      backgroundColor: 'rgba(255,255,255,0.55)',
      borderRadius: '50%',
      display: 'flex',
      height: 28,
      width: 28,
    }),
  )

/** The owner's avatar as a circular badge (Satori clips via borderRadius). */
const avatarBadge = (dataUri: string): El => ({
  props: {
    height: 80,
    src: dataUri,
    style: { border: '4px solid rgba(255,255,255,0.9)', borderRadius: '50%' },
    width: 80,
  },
  type: 'img',
})

const DEFAULT_GRADIENT: ChallengeTheme['gradient'] = ['#0b1a30', '#0f2a4f', '#17707a']

const MAX_STANDINGS_ROWS = 3
// Name column (260) + bar + gap (20) + total label must fit the 1040px content width.
const MAX_BAR_WIDTH = 500

const mutedLine = (text: string, marginTop = 12): El =>
  el('div', { color: 'rgba(255,255,255,0.75)', display: 'flex', fontSize: 30, marginTop }, text)

export interface ChallengeCallToAction {
  headline: string
  invite: boolean
}

/** What a card without standings says: a join prompt while it can be joined, a plain count once it has ended. */
export const challengeCallToAction = (
  challenge: Pick<OgChallengeDetails, 'joined' | 'members' | 'status'>,
): ChallengeCallToAction | null => {
  if (challenge.status === 'ended') {
    return challenge.members.length > 0
      ? { headline: `${challenge.members.length} took part`, invite: false }
      : null
  }
  return {
    headline: challenge.joined === 0 ? 'Be the first to join' : `${challenge.joined} joined`,
    invite: true,
  }
}

const callToAction = ({ headline, invite }: ChallengeCallToAction): El =>
  el('div', { display: 'flex', flexDirection: 'column' }, [
    el('div', { display: 'flex', fontSize: 40, fontWeight: 700 }, headline),
    ...(invite ? [mutedLine('Join from any Aurboda instance')] : []),
  ])

const formatTotal = (total: number, unit: string): string =>
  `${total.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`.trimEnd()

const standingRow = (member: OgChallengeMember & { total: number }, best: number, unit: string): El =>
  el('div', { alignItems: 'center', display: 'flex', marginTop: 8 }, [
    el(
      'div',
      { display: 'flex', flexShrink: 0, fontSize: 30, fontWeight: 700, width: 260 },
      clampTitle(member.name, 18),
    ),
    el('div', {
      backgroundColor: 'rgba(255,255,255,0.9)',
      borderRadius: 14,
      display: 'flex',
      height: 28,
      width: Math.max(4, Math.round((MAX_BAR_WIDTH * member.total) / best)),
    }),
    el(
      'div',
      { display: 'flex', flexShrink: 0, fontSize: 30, marginLeft: 20, whiteSpace: 'nowrap' },
      formatTotal(member.total, unit),
    ),
  ])

/** Standings once there are numbers, otherwise the call to action. */
const challengeMiddle = (challenge: OgChallengeDetails): El[] => {
  const scored = challenge.members.filter(
    (m): m is OgChallengeMember & { total: number } => m.total !== null && m.total > 0,
  )
  if (scored.length > 0) {
    const shown = scored.slice(0, MAX_STANDINGS_ROWS)
    const more = challenge.members.length - shown.length
    return [
      el('div', { display: 'flex', flexDirection: 'column' }, [
        ...shown.map((m) => standingRow(m, shown[0].total, challenge.unit)),
        ...(more > 0 ? [mutedLine(`+${more} more`, 4)] : []),
      ]),
    ]
  }
  const action = challengeCallToAction(challenge)
  return action ? [callToAction(action)] : []
}

const SPARKLINE_WIDTH = 460
const SPARKLINE_HEIGHT = 170
const SPARKLINE_STROKE = 6

/** A trend line as a standalone SVG: x evenly spread, y scaled min→max, inset so the stroke is not clipped. */
export const sparklineSvg = (values: number[], width: number, height: number): string => {
  const inset = SPARKLINE_STROKE
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = values.length > 1 ? (width - 2 * inset) / (values.length - 1) : 0
  const y = (v: number): number =>
    max === min ? height / 2 : inset + ((max - v) / (max - min)) * (height - 2 * inset)
  const points = values
    .map((v, i) => `${Number((inset + i * step).toFixed(1))},${Number(y(v).toFixed(1))}`)
    .join(' ')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<polyline fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${SPARKLINE_STROKE}" ` +
    `stroke-linejoin="round" stroke-linecap="round" points="${points}"/></svg>`
  )
}

const sparkline = (values: number[]): El => ({
  props: {
    height: SPARKLINE_HEIGHT,
    src: `data:image/svg+xml;base64,${Buffer.from(sparklineSvg(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)).toString('base64')}`,
    style: { flexShrink: 0 },
    width: SPARKLINE_WIDTH,
  },
  type: 'img',
})

/** The headline record over its label and the session count, the trend line beside them. */
const exerciseMiddle = ({ headline, sessions, sparkline: values }: OgExerciseDetails): El[] => {
  const facts = headline
    ? [
        el('div', { display: 'flex', fontSize: 72, fontWeight: 700, lineHeight: 1 }, headline.value),
        mutedLine(`${headline.label} · ${headline.date}`, 16),
        ...(sessions ? [mutedLine(sessions, 8)] : []),
      ]
    : sessions
      ? [el('div', { display: 'flex', fontSize: 40, fontWeight: 700 }, sessions)]
      : []
  if (facts.length === 0) return []
  return [
    el('div', { alignItems: 'flex-end', display: 'flex', justifyContent: 'space-between' }, [
      el('div', { display: 'flex', flexDirection: 'column' }, facts),
      ...(values.length >= 2 ? [sparkline(values)] : []),
    ]),
  ]
}

const CHART_PANEL_PADDING = 16
const CHART_WIDTH = OG_WIDTH - 2 * 80 - 2 * CHART_PANEL_PADDING
const MAX_LEGEND_ENTRIES = 4

const chartImage = (chart: PostChart, height: number): El => ({
  props: {
    height,
    src: `data:image/svg+xml;base64,${Buffer.from(postChartSvg(chart, { bare: true, height, width: CHART_WIDTH })).toString('base64')}`,
    style: { flexShrink: 0 },
    width: CHART_WIDTH,
  },
  type: 'img',
})

const legendEntry = (name: string, color: string): El =>
  el('div', { alignItems: 'center', display: 'flex', marginLeft: 24 }, [
    el('div', { backgroundColor: color, borderRadius: 4, display: 'flex', height: 16, width: 16 }),
    el('div', { display: 'flex', marginLeft: 8 }, clampTitle(name, 14)),
  ])

/**
 * The caption, and a race's leading members in their line colours, are Satori text: inside the
 * chart SVG librsvg would draw them as tofu.
 */
const chartCaption = (chart: PostChart): El =>
  el('div', { color: 'rgba(255,255,255,0.8)', display: 'flex', fontSize: 24, marginBottom: 6 }, [
    el('div', { display: 'flex', fontWeight: 700 }, clampTitle(postChartCaption(chart), 40)),
    ...(chart.type === 'race'
      ? chart.data.lines.slice(0, MAX_LEGEND_ENTRIES).map((line) => legendEntry(line.name, line.color))
      : []),
  ])

/** Up to here a title fits one line at the larger size, and the chart gets the room a second line would take. */
const ONE_LINE_CHART_TITLE = 30

const chartTitleSize = (title: string): number =>
  graphemesOf(title).length <= ONE_LINE_CHART_TITLE ? 64 : 52

const chartHeight = (title: string): number => (graphemesOf(title).length <= ONE_LINE_CHART_TITLE ? 150 : 104)

const chartMiddle = (chart: PostChart, title: string): El[] => [
  el(
    'div',
    {
      backgroundColor: 'rgba(5,10,20,0.45)',
      borderRadius: 20,
      display: 'flex',
      flexDirection: 'column',
      padding: CHART_PANEL_PADDING,
    },
    [chartCaption(chart), chartImage(chart, chartHeight(title))],
  ),
]

/**
 * A challenge or exercise card carries a middle block, and a post card a one-line excerpt, so a
 * long title steps down rather than wrapping onto it.
 */
const steppedTitleSize = (title: string): number => {
  const length = graphemesOf(title).length
  if (length <= 20) return 82
  if (length <= 30) return 64
  return 52
}

const motif = (emoji: string): El =>
  el(
    'div',
    { display: 'flex', fontSize: 300, opacity: 0.28, position: 'absolute', right: 60, top: 40 },
    emoji,
  )

const bannerBackground = (dataUri: string): El[] => [
  {
    props: {
      height: OG_HEIGHT,
      src: dataUri,
      style: { left: 0, objectFit: 'cover', position: 'absolute', top: 0 },
      width: OG_WIDTH,
    },
    type: 'img',
  },
  el('div', {
    backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.78) 100%)',
    display: 'flex',
    height: OG_HEIGHT,
    left: 0,
    position: 'absolute',
    top: 0,
    width: OG_WIDTH,
  }),
]

export const eyebrowOf = ({ challenge, eyebrow, exercise, kind }: OgCard): string => {
  if (eyebrow) return eyebrow
  const qualifier = challenge?.measure ?? exercise?.activityTypeName
  return qualifier ? `${KIND_LABEL[kind]} · ${clampTitle(qualifier, 24)}` : KIND_LABEL[kind]
}

const middleOf = ({ challenge, chart, exercise, title }: OgCard): El[] => {
  if (challenge) return challengeMiddle(challenge)
  if (chart) return chartMiddle(chart, title)
  return exercise ? exerciseMiddle(exercise) : []
}

const titleSizeOf = ({ challenge, chart, exercise, kind, title }: OgCard): number => {
  if (chart) return chartTitleSize(title)
  return challenge || exercise || kind === 'post' ? steppedTitleSize(title) : 82
}

/** A challenge's dates and status, else the subtitle unless a chart takes its place. */
const underTitleOf = ({ challenge, chart, subtitle }: OgCard): El | null => {
  if (challenge) {
    return el(
      'div',
      { color: 'rgba(255,255,255,0.85)', display: 'flex', fontSize: 36, marginTop: 16 },
      `${challenge.range} · ${challenge.phrase}`,
    )
  }
  if (chart || !subtitle) return null
  return el(
    'div',
    {
      color: 'rgba(255,255,255,0.85)',
      display: 'flex',
      fontSize: 38,
      marginTop: 28,
    },
    subtitle,
  )
}

/** Build the Satori element tree for a card. */
const cardTree = (card: OgCard): El => {
  const { challenge } = card
  const [dark, mid, light] = challenge?.theme.gradient ?? DEFAULT_GRADIENT
  const eyebrow = eyebrowOf(card)
  const underTitle = underTitleOf(card)

  return el(
    'div',
    {
      backgroundColor: dark,
      backgroundImage: `linear-gradient(135deg, ${dark} 0%, ${mid} 55%, ${light} 100%)`,
      color: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT_FAMILY,
      height: '100%',
      justifyContent: 'space-between',
      padding: '80px',
      width: '100%',
    },
    [
      ...(challenge?.bannerDataUri
        ? bannerBackground(challenge.bannerDataUri)
        : challenge
          ? [motif(challenge.theme.emoji)]
          : []),
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el(
          'div',
          {
            color: 'rgba(255,255,255,0.75)',
            display: 'flex',
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: 'uppercase',
          },
          eyebrow,
        ),
        el(
          'div',
          {
            display: 'flex',
            fontSize: titleSizeOf(card),
            fontWeight: 700,
            lineHeight: 1.1,
            marginTop: 24,
            // Satori has no line clamp; the caller truncates long titles.
          },
          card.title,
        ),
        ...(underTitle ? [underTitle] : []),
      ]),
      ...middleOf(card),
      el('div', { alignItems: 'center', display: 'flex' }, [
        card.avatarDataUri ? avatarBadge(card.avatarDataUri) : ringBadge(),
        el('div', { display: 'flex', fontSize: 44, fontWeight: 700, marginLeft: 24 }, 'Aurboda'),
        ...(card.username
          ? [
              el(
                'div',
                { color: 'rgba(255,255,255,0.75)', display: 'flex', fontSize: 36, marginLeft: 16 },
                `· @${card.username}`,
              ),
            ]
          : []),
      ]),
    ],
  )
}

const graphemesOf = (text: string): string[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)

/** Longest title that fits the card comfortably before Satori would overflow. */
export const clampTitle = (title: string, max = 60): string => {
  const graphemes = graphemesOf(title)
  if (graphemes.length <= max) return title
  const kept = graphemes.slice(0, max - 1).join('')
  return `${kept.trimEnd()}…`
}

/**
 * Create a renderer that turns card data into a branded 1200×630 PNG. Fonts are
 * loaded once and memoized inside the returned closure (no module-level state).
 */
export const createOgImageRenderer = (): ((card: OgCard) => Promise<Buffer>) => {
  const loadFonts = createFontLoader()
  const loadEmoji = createEmojiLoader()
  return async (card) => {
    const fonts = await loadFonts()
    const svg = await satori(cardTree({ ...card, title: clampTitle(card.title) }), {
      fonts,
      height: OG_HEIGHT,
      loadAdditionalAsset: (code, segment) => (code === 'emoji' ? loadEmoji(segment) : Promise.resolve([])),
      width: OG_WIDTH,
    })
    return sharp(Buffer.from(svg)).png().toBuffer()
  }
}
