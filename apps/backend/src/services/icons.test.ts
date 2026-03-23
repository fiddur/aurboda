import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { isAllowedContentType, processIcon } from './icons.ts'

const MAX_BYTES = 256 * 1024

describe('isAllowedContentType', () => {
  test('accepts valid image types', () => {
    expect(isAllowedContentType('image/png')).toBe(true)
    expect(isAllowedContentType('image/jpeg')).toBe(true)
    expect(isAllowedContentType('image/webp')).toBe(true)
    expect(isAllowedContentType('image/gif')).toBe(true)
    expect(isAllowedContentType('image/svg+xml')).toBe(true)
  })

  test('rejects invalid types', () => {
    expect(isAllowedContentType('text/html')).toBe(false)
    expect(isAllowedContentType('application/pdf')).toBe(false)
    expect(isAllowedContentType('image/bmp')).toBe(false)
  })
})

describe('processIcon', () => {
  test('rejects unsupported content type', async () => {
    await expect(processIcon(Buffer.from('data'), 'text/plain')).rejects.toThrow('Unsupported content type')
  })

  test('passes through SVG under size limit', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
    const result = await processIcon(svg, 'image/svg+xml')
    expect(result.content_type).toBe('image/svg+xml')
    expect(result.data).toEqual(svg)
  })

  test('rejects SVG over size limit', async () => {
    const svg = Buffer.alloc(MAX_BYTES + 1, 'x')
    await expect(processIcon(svg, 'image/svg+xml')).rejects.toThrow('SVG exceeds')
  })

  test('passes through small PNG without modification', async () => {
    // Create a tiny 2x2 PNG — well under 256KB
    const smallPng = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()

    expect(smallPng.length).toBeLessThan(MAX_BYTES)
    const result = await processIcon(smallPng, 'image/png')
    expect(result.content_type).toBe('image/png')
    expect(result.data).toEqual(smallPng)
  })

  test('resizes large PNG to fit within limit', async () => {
    // Create a 1000x1000 PNG with random-ish data to exceed 256KB
    const largePng = await sharp({
      create: { width: 1000, height: 1000, channels: 4, background: { r: 128, g: 64, b: 192, alpha: 1 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer()

    // If this doesn't exceed the limit naturally, add noise
    const inputSize = largePng.length
    if (inputSize <= MAX_BYTES) {
      // The solid color compresses well, so test with noisy data
      const noisyPng = await sharp(
        Buffer.from(Array.from({ length: 1000 * 1000 * 4 }, () => Math.floor(Math.random() * 256))),
        { raw: { width: 1000, height: 1000, channels: 4 } },
      )
        .png({ compressionLevel: 0 })
        .toBuffer()

      expect(noisyPng.length).toBeGreaterThan(MAX_BYTES)
      const result = await processIcon(noisyPng, 'image/png')
      expect(result.data.length).toBeLessThanOrEqual(MAX_BYTES)
      expect(result.content_type).toBe('image/png')

      // Verify resized dimensions
      const metadata = await sharp(result.data).metadata()
      expect(metadata.width).toBeLessThanOrEqual(256)
      expect(metadata.height).toBeLessThanOrEqual(256)
    } else {
      const result = await processIcon(largePng, 'image/png')
      expect(result.data.length).toBeLessThanOrEqual(MAX_BYTES)
    }
  })

  test('resizes large JPEG', async () => {
    // Create a large JPEG from noisy data
    const noisyJpeg = await sharp(
      Buffer.from(Array.from({ length: 1000 * 1000 * 3 }, () => Math.floor(Math.random() * 256))),
      { raw: { width: 1000, height: 1000, channels: 3 } },
    )
      .jpeg({ quality: 100 })
      .toBuffer()

    if (noisyJpeg.length > MAX_BYTES) {
      const result = await processIcon(noisyJpeg, 'image/jpeg')
      expect(result.data.length).toBeLessThanOrEqual(MAX_BYTES)
      expect(result.content_type).toBe('image/jpeg')
    }
  })

  test('handles GIF passthrough', async () => {
    // Create a small single-frame GIF
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .gif()
      .toBuffer()

    expect(gif.length).toBeLessThan(MAX_BYTES)
    const result = await processIcon(gif, 'image/gif')
    expect(result.content_type).toBe('image/gif')
    expect(result.data).toEqual(gif)
  })
})
