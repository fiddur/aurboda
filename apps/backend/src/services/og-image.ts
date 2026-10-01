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

import type { ChallengeTheme } from './og-challenge-theme.ts'

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
  /** "1 Oct – 31 Oct 2026" */
  range: string
  /** "Starts in 3 days" / "Ends tomorrow" / "Ended 31 Oct 2026" */
  phrase: string
  status: ChallengeTimeStatus
  /** Active members, best total first; totals null while nothing has been fetched. */
  members: OgChallengeMember[]
}

/** What the card should say. `kind` drives the small uppercase eyebrow label. */
export interface OgCard {
  kind: 'dashboard' | 'challenge' | 'profile'
  title: string
  subtitle?: string
  /** Optional `data:` URI for the owner's avatar, shown next to the wordmark. */
  avatarDataUri?: string
  /** Who owns the resource, shown next to the wordmark as "@name". */
  username?: string
  challenge?: OgChallengeDetails
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
    let dataUri = cache.get(candidates[0])
    if (!dataUri) {
      dataUri = readSvg(candidates)
      cache.set(candidates[0], dataUri)
    }
    return (await dataUri) ?? []
  }
}

const KIND_LABEL: Record<OgCard['kind'], string> = {
  challenge: 'Challenge',
  dashboard: 'Dashboard',
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

const DEFAULT_GRADIENT: ChallengeTheme['gradient'] = ['#4c1d95', '#673ab8', '#8b5cf6']

const MAX_STANDINGS_ROWS = 3
// Name column (260) + bar + gap (20) + total label must fit the 1040px content width.
const MAX_BAR_WIDTH = 500

const mutedLine = (text: string, marginTop = 12): El =>
  el('div', { color: 'rgba(255,255,255,0.75)', display: 'flex', fontSize: 30, marginTop }, text)

const callToAction = (headline: string): El =>
  el('div', { display: 'flex', flexDirection: 'column' }, [
    el('div', { display: 'flex', fontSize: 40, fontWeight: 700 }, headline),
    mutedLine('Join from any Aurboda instance'),
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

/** Standings once there are numbers, a join prompt before; nothing for an ended challenge nobody joined. */
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
  if (challenge.members.length > 0) return [callToAction(`${challenge.members.length} joined`)]
  if (challenge.status === 'ended') return []
  return [callToAction('Be the first to join')]
}

/** A challenge card also carries standings, so a long name steps down rather than wrapping onto them. */
const challengeTitleSize = (title: string): number => {
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

/** Build the Satori element tree for a card. */
const cardTree = (card: OgCard): El => {
  const { challenge } = card
  const [dark, mid, light] = challenge?.theme.gradient ?? DEFAULT_GRADIENT
  const eyebrow = challenge
    ? `${KIND_LABEL[card.kind]} · ${clampTitle(challenge.measure, 24)}`
    : KIND_LABEL[card.kind]
  const underTitle = challenge
    ? el(
        'div',
        { color: 'rgba(255,255,255,0.85)', display: 'flex', fontSize: 36, marginTop: 16 },
        `${challenge.range} · ${challenge.phrase}`,
      )
    : card.subtitle
      ? el(
          'div',
          {
            color: 'rgba(255,255,255,0.85)',
            display: 'flex',
            fontSize: 38,
            marginTop: 28,
          },
          card.subtitle,
        )
      : null

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
      ...(challenge ? [motif(challenge.theme.emoji)] : []),
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
            fontSize: challenge ? challengeTitleSize(card.title) : 82,
            fontWeight: 700,
            lineHeight: 1.1,
            marginTop: 24,
            // Satori has no line clamp; the caller truncates long titles.
          },
          card.title,
        ),
        ...(underTitle ? [underTitle] : []),
      ]),
      ...(challenge ? challengeMiddle(challenge) : []),
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
