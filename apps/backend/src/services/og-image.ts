/**
 * Dynamic Open Graph preview images (1200×630 PNG) for public share pages.
 *
 * Satori renders a branded card (HTML/flexbox subset → SVG) and sharp
 * rasterizes it to PNG. Fonts are bundled (see assets/fonts/README.md) because
 * the production image has no system fonts. Everything is a pure function of the
 * passed-in card data — callers resolve visibility first and never render a
 * private resource.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import satori, { type Font } from 'satori'
import sharp from 'sharp'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/** What the card should say. `kind` drives the small uppercase eyebrow label. */
export interface OgCard {
  kind: 'dashboard' | 'challenge' | 'profile'
  title: string
  subtitle?: string
  /** Optional `data:` URI for the owner's avatar, shown next to the wordmark. */
  avatarDataUri?: string
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

/** Build the Satori element tree for a card. */
const cardTree = (card: OgCard): El =>
  el(
    'div',
    {
      backgroundColor: '#4c1d95',
      backgroundImage: 'linear-gradient(135deg, #4c1d95 0%, #673ab8 55%, #8b5cf6 100%)',
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
          KIND_LABEL[card.kind],
        ),
        el(
          'div',
          {
            display: 'flex',
            fontSize: 82,
            fontWeight: 700,
            lineHeight: 1.1,
            marginTop: 24,
            // Satori has no line clamp; the caller truncates long titles.
          },
          card.title,
        ),
        ...(card.subtitle
          ? [
              el(
                'div',
                {
                  color: 'rgba(255,255,255,0.85)',
                  display: 'flex',
                  fontSize: 38,
                  marginTop: 28,
                },
                card.subtitle,
              ),
            ]
          : []),
      ]),
      el('div', { alignItems: 'center', display: 'flex' }, [
        card.avatarDataUri ? avatarBadge(card.avatarDataUri) : ringBadge(),
        el('div', { display: 'flex', fontSize: 44, fontWeight: 700, marginLeft: 24 }, 'Aurboda'),
      ]),
    ],
  )

/** Longest title that fits the card comfortably before Satori would overflow. */
export const clampTitle = (title: string, max = 60): string =>
  title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`

/**
 * Create a renderer that turns card data into a branded 1200×630 PNG. Fonts are
 * loaded once and memoized inside the returned closure (no module-level state).
 */
export const createOgImageRenderer = (): ((card: OgCard) => Promise<Buffer>) => {
  const loadFonts = createFontLoader()
  return async (card) => {
    const fonts = await loadFonts()
    const svg = await satori(cardTree({ ...card, title: clampTitle(card.title) }), {
      fonts,
      height: OG_HEIGHT,
      width: OG_WIDTH,
    })
    return sharp(Buffer.from(svg)).png().toBuffer()
  }
}
