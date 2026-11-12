import {
  addFeedImageInputSchema,
  feedImageSchema,
  MAX_FEED_IMAGE_BYTES,
  MAX_FEED_IMAGES_PER_ACCOUNT,
} from '@aurboda/api-spec'
import sharp from 'sharp'
import { describe, expect, test, vi } from 'vitest'

import type { FeedImageRecord } from '../db/index.ts'

import { addFeedImage, feedImageUrl, processFeedImage, serializeFeedImage } from './feed-image.ts'

const solid = (width: number, height: number) =>
  sharp({ create: { background: { b: 90, g: 150, r: 20 }, channels: 3, height, width } })

const svgBytes = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
)

describe('processFeedImage', () => {
  test.each([
    ['png', () => solid(40, 30).png().toBuffer()],
    ['jpeg', () => solid(40, 30).jpeg().toBuffer()],
    ['webp', () => solid(40, 30).webp().toBuffer()],
    ['gif', () => solid(40, 30).gif().toBuffer()],
  ])('stores a %s as WebP', async (_format, make) => {
    const result = await processFeedImage(await make())
    expect(result.content_type).toBe('image/webp')
    expect((await sharp(result.data).metadata()).format).toBe('webp')
    expect({ height: result.height, width: result.width }).toEqual({ height: 30, width: 40 })
  })

  test('refuses an SVG', async () => {
    await expect(processFeedImage(svgBytes)).rejects.toThrow()
  })

  test('refuses bytes that are no picture at all', async () => {
    await expect(processFeedImage(Buffer.from('a cup of coffee'))).rejects.toThrow()
  })

  test('shrinks the longest edge to 1600 px', async () => {
    const result = await processFeedImage(await solid(4000, 2000).png().toBuffer())
    expect({ height: result.height, width: result.width }).toEqual({ height: 800, width: 1600 })
    const stored = await sharp(result.data).metadata()
    expect({ height: stored.height, width: stored.width }).toEqual({ height: 800, width: 1600 })
  })

  test('does not enlarge a smaller picture', async () => {
    const result = await processFeedImage(await solid(300, 200).png().toBuffer())
    expect({ height: result.height, width: result.width }).toEqual({ height: 200, width: 300 })
  })

  test('applies the EXIF orientation and drops the EXIF block, GPS position included', async () => {
    const withExif = await solid(400, 200)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Make: 'Yoga camera' },
        IFD3: { GPSLatitude: '59/1 20/1 0/1', GPSLatitudeRef: 'N' },
      })
      .toBuffer()
    const before = await sharp(withExif).metadata()
    expect(before.orientation).toBe(6)
    expect(before.exif).toBeDefined()
    expect(withExif.includes(Buffer.from('Yoga camera'))).toBe(true)

    const result = await processFeedImage(withExif)
    expect({ height: result.height, width: result.width }).toEqual({ height: 400, width: 200 })
    const after = await sharp(result.data).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.orientation).toBeUndefined()
    expect(result.data.includes(Buffer.from('Yoga camera'))).toBe(false)
  })
})

describe('feedImageUrl', () => {
  test('builds the public URL under the API base', () => {
    expect(feedImageUrl('https://aurboda.test/api', 'alice', 'abc')).toBe(
      'https://aurboda.test/api/public/alice/images/abc.webp',
    )
  })
})

const record: FeedImageRecord = {
  byte_size: 1234,
  content_type: 'image/webp',
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 600,
  id: '00000000-0000-4000-8000-000000000001',
  width: 800,
}

describe('serializeFeedImage', () => {
  test('answers the API shape with an ISO time and the public URL', () => {
    expect(serializeFeedImage('https://aurboda.test/api', 'alice', record)).toEqual({
      byte_size: 1234,
      created_at: '2026-11-01T08:00:00.000Z',
      height: 600,
      id: record.id,
      url: `https://aurboda.test/api/public/alice/images/${record.id}.webp`,
      width: 800,
    })
  })

  test('answers what FeedImage describes', () => {
    expect(
      feedImageSchema.safeParse(serializeFeedImage('https://aurboda.test/api', 'alice', record)).success,
    ).toBe(true)
  })
})

describe('addFeedImageInputSchema', () => {
  test('takes base64 bytes up to the size limit', () => {
    expect(addFeedImageInputSchema.safeParse({ data_base64: 'cG5n' }).success).toBe(true)
    expect(
      addFeedImageInputSchema.safeParse({
        data_base64: Buffer.alloc(MAX_FEED_IMAGE_BYTES).toString('base64'),
      }).success,
    ).toBe(true)
  })

  test('refuses nothing and more than the size limit', () => {
    expect(addFeedImageInputSchema.safeParse({ data_base64: '' }).success).toBe(false)
    expect(
      addFeedImageInputSchema.safeParse({
        data_base64: Buffer.alloc(MAX_FEED_IMAGE_BYTES + 3).toString('base64'),
      }).success,
    ).toBe(false)
  })
})

describe('addFeedImage', () => {
  const processed = { content_type: 'image/webp', data: Buffer.from([1]), height: 600, width: 800 }
  const deps = (count: number, process = vi.fn(async () => processed)) => ({
    countFeedImages: vi.fn(async () => count),
    insertFeedImage: vi.fn(async () => record),
    processFeedImage: process,
  })

  test('processes and stores the picture', async () => {
    const d = deps(3)
    expect(await addFeedImage('alice', Buffer.from([9]), d)).toEqual({ image: record, ok: true })
    expect(d.processFeedImage).toHaveBeenCalledWith(Buffer.from([9]))
    expect(d.insertFeedImage).toHaveBeenCalledWith('alice', processed)
  })

  test('refuses at the cap without processing or storing', async () => {
    const d = deps(MAX_FEED_IMAGES_PER_ACCOUNT)
    expect(await addFeedImage('alice', Buffer.from([9]), d)).toEqual({ ok: false, reason: 'limit' })
    expect(d.processFeedImage).not.toHaveBeenCalled()
    expect(d.insertFeedImage).not.toHaveBeenCalled()
  })

  test('answers unsupported when the picture cannot be processed', async () => {
    const d = deps(
      0,
      vi.fn(async () => {
        throw new Error('Unsupported image format: svg')
      }),
    )
    expect(await addFeedImage('alice', svgBytes, d)).toEqual({ ok: false, reason: 'unsupported' })
    expect(d.insertFeedImage).not.toHaveBeenCalled()
  })
})
