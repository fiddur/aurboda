import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { generateIdenticon } from './avatar.ts'
import { clampTitle, createOgImageRenderer, OG_HEIGHT, OG_WIDTH } from './og-image.ts'

const renderOgImage = createOgImageRenderer()

describe('clampTitle', () => {
  test('leaves short titles untouched', () => {
    expect(clampTitle('Training')).toBe('Training')
  })

  test('truncates long titles with an ellipsis', () => {
    const clamped = clampTitle('x'.repeat(120))
    expect(clamped.length).toBeLessThanOrEqual(60)
    expect(clamped.endsWith('…')).toBe(true)
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
})
