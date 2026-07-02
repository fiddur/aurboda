import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { AVATAR_SIZE, generateIdenticon, isAllowedAvatarType, processAvatar } from './avatar.ts'

const solidPng = (w: number, h: number) =>
  sharp({ create: { background: { b: 90, g: 150, r: 20 }, channels: 3, height: h, width: w } })
    .png()
    .toBuffer()

describe('isAllowedAvatarType', () => {
  test('accepts common raster types, rejects svg and others', () => {
    expect(isAllowedAvatarType('image/png')).toBe(true)
    expect(isAllowedAvatarType('image/jpeg')).toBe(true)
    expect(isAllowedAvatarType('image/webp')).toBe(true)
    expect(isAllowedAvatarType('image/gif')).toBe(true)
    expect(isAllowedAvatarType('image/svg+xml')).toBe(false)
    expect(isAllowedAvatarType('application/pdf')).toBe(false)
  })
})

describe('processAvatar', () => {
  test('normalizes any input to a square 256x256 webp', async () => {
    const { content_type, data } = await processAvatar(await solidPng(500, 300))
    expect(content_type).toBe('image/webp')
    const meta = await sharp(data).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
  })

  test('rejects a non-image buffer', async () => {
    await expect(processAvatar(Buffer.from('not an image'))).rejects.toThrow()
  })

  test('rejects SVG bytes even if the caller claims a raster mimetype', async () => {
    // Content-Type spoofing: SVG bytes are what sharp detects, so this must fail
    // regardless of the mimetype multer reported.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    await expect(processAvatar(svg)).rejects.toThrow(/format/i)
  })
})

describe('generateIdenticon', () => {
  test('produces a deterministic 256x256 png for a seed', async () => {
    const a = await generateIdenticon('fiddur')
    const b = await generateIdenticon('fiddur')
    expect(a.content_type).toBe('image/png')
    expect(a.data.equals(b.data)).toBe(true)
    const meta = await sharp(a.data).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
  })

  test('differs between distinct seeds', async () => {
    const a = await generateIdenticon('alice')
    const b = await generateIdenticon('bob')
    expect(a.data.equals(b.data)).toBe(false)
  })
})
