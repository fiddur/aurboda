import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { generateIdenticon } from './avatar.ts'
import { challengeTheme } from './og-challenge-theme.ts'
import {
  clampTitle,
  createOgImageRenderer,
  OG_HEIGHT,
  OG_WIDTH,
  type OgCard,
  type OgChallengeMember,
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

const stepsCard = (members: OgChallengeMember[], status: 'ongoing' | 'upcoming'): OgCard => ({
  challenge: {
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
})
