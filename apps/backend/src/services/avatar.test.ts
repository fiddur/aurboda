import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import {
  AVATAR_SIZE,
  BANNER_HEIGHT,
  BANNER_WIDTH,
  generateIdenticon,
  isAllowedImageType,
  MAX_UPLOAD_PIXELS,
  processAvatar,
  processBanner,
} from './avatar.ts'
import { processFeedImage } from './feed-image.ts'

const solidPng = (w: number, h: number) =>
  sharp({ create: { background: { b: 90, g: 150, r: 20 }, channels: 3, height: h, width: w } })
    .png()
    .toBuffer()

describe('isAllowedImageType', () => {
  test('accepts common raster types, rejects svg and others', () => {
    expect(isAllowedImageType('image/png')).toBe(true)
    expect(isAllowedImageType('image/jpeg')).toBe(true)
    expect(isAllowedImageType('image/webp')).toBe(true)
    expect(isAllowedImageType('image/gif')).toBe(true)
    expect(isAllowedImageType('image/svg+xml')).toBe(false)
    expect(isAllowedImageType('application/pdf')).toBe(false)
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

describe('processBanner', () => {
  test('crops a wide image to a 1200x630 webp', async () => {
    const { content_type, data } = await processBanner(await solidPng(2000, 500))
    expect(content_type).toBe('image/webp')
    const meta = await sharp(data).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(BANNER_WIDTH)
    expect(meta.height).toBe(BANNER_HEIGHT)
  })

  test('rejects SVG bytes claimed as PNG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    await expect(processBanner(svg)).rejects.toThrow(/format/i)
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

describe('the upload pixel limit', () => {
  const pngChunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  // A few hundred bytes that declare 12000×10000 pixels: under sharp's own default, over ours.
  const hugeDimensionsPng = () => {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(12_000, 0)
    header.writeUInt32BE(10_000, 4)
    header[8] = 8
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(Buffer.alloc(12_001))),
      pngChunk('IEND', Buffer.alloc(0)),
    ])
  }

  test('a small file with huge dimensions is refused before it is decoded', async () => {
    expect(12_000 * 10_000).toBeGreaterThan(MAX_UPLOAD_PIXELS)
    await expect(processAvatar(hugeDimensionsPng())).rejects.toThrow(/pixel limit/)
    await expect(processBanner(hugeDimensionsPng())).rejects.toThrow(/pixel limit/)
    await expect(processFeedImage(hugeDimensionsPng())).rejects.toThrow(/pixel limit/)
  })
})
