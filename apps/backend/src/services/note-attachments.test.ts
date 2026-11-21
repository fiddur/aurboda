import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, test, vi } from 'vitest'

import type { NoteAttachmentRecord } from '../db/index.ts'
import type { Note } from '../db/types.ts'

import {
  addNoteAttachment,
  assistantNoteImage,
  deleteNoteAttachment,
  getNoteAttachmentContent,
  getNoteAttachmentForAssistant,
  listDeletedNoteAttachments,
  type NoteAttachmentDeps,
  noteAttachmentFailure,
  processNoteAttachment,
  processNoteImage,
  restoreNoteAttachmentById,
  hasMp4VideoTrack,
  resizeNoteImage,
  sniffAudioMime,
} from './note-attachments.ts'

const USER = 'alice'
const NOTE_ID = randomUUID()

const entry = (overrides: Partial<Note> = {}): Note => ({
  content: '',
  created_at: new Date('2026-11-01T08:00:00Z'),
  entity_id: null,
  entity_type: 'day',
  id: NOTE_ID,
  updated_at: new Date('2026-11-01T08:00:00Z'),
  ...overrides,
})

const record = (overrides: Partial<NoteAttachmentRecord> = {}): NoteAttachmentRecord => ({
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 40,
  id: randomUUID(),
  kind: 'image',
  mime: 'image/webp',
  note_id: NOTE_ID,
  position: 1,
  size: 100,
  width: 20,
  ...overrides,
})

const makeDeps = (overrides: Partial<NoteAttachmentDeps> = {}): NoteAttachmentDeps => ({
  getAttachment: vi.fn(async () => record()),
  getBytes: vi.fn(async () => ({ bytes: Buffer.from('stored'), kind: 'image', mime: 'image/webp' })),
  getNoteById: vi.fn(async () => entry()),
  getStripMetadata: vi.fn(async () => false),
  getUsage: vi.fn(async () => ({ account_bytes: 0, live_count: 0, max_position: null })),
  insert: vi.fn(async (_user, _note, a) => ({
    ok: true as const,
    value: record({ height: a.height, kind: a.kind, mime: a.mime, size: a.bytes.length, width: a.width }),
  })),
  listDeleted: vi.fn(async () => []),
  listLive: vi.fn(async () => new Map()),
  process: vi.fn(async (buffer: Buffer) => ({
    bytes: buffer,
    height: 40,
    kind: 'image' as const,
    mime: 'image/webp',
    width: 20,
  })),
  purge: vi.fn(async () => true),
  resize: vi.fn(async () => Buffer.from('small')),
  restore: vi.fn(async () => ({ ok: true as const, value: record() })),
  softDelete: vi.fn(async () => true),
  toAssistantImage: vi.fn(async () => Buffer.from('jpeg')),
  ...overrides,
})

const solid = (width: number, height: number) =>
  sharp({ create: { background: { b: 40, g: 120, r: 200 }, channels: 3, height, width } })

const GPS_IFD_TAG = Buffer.from([0x25, 0x88])

/** A sideways (orientation 6) camera JPEG with a camera make and a GPS position in its EXIF. */
const cameraJpeg = () =>
  solid(40, 20)
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: {
        GPSLatitude: '59/1 20/1 0/1',
        GPSLatitudeRef: 'N',
        GPSLongitude: '18/1 4/1 0/1',
        GPSLongitudeRef: 'E',
      },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer()

describe('processNoteImage', () => {
  test('keeps the EXIF, GPS included, and stores the picture upright', async () => {
    const jpeg = await cameraJpeg()
    const source = await sharp(jpeg).metadata()
    expect(source.orientation).toBe(6)
    expect(source.exif?.includes(GPS_IFD_TAG)).toBe(true)

    const stored = await processNoteImage(jpeg)

    expect(stored).toMatchObject({ height: 40, kind: 'image', mime: 'image/webp', width: 20 })
    const meta = await sharp(stored.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect([meta.width, meta.height]).toEqual([20, 40])
    expect(meta.orientation ?? 1).toBe(1)
    expect(meta.exif?.includes('TestCam')).toBe(true)
    expect(meta.exif?.includes(GPS_IFD_TAG)).toBe(true)
  })

  test('applies the EXIF orientation, drops the metadata when asked and stores WebP', async () => {
    const jpeg = await cameraJpeg()

    const stored = await processNoteImage(jpeg, { stripMetadata: true })

    expect(stored).toMatchObject({ height: 40, kind: 'image', mime: 'image/webp', width: 20 })
    const meta = await sharp(stored.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(20)
    expect(meta.height).toBe(40)
    expect(meta.orientation).toBeUndefined()
    expect(meta.exif).toBeUndefined()
  })

  test('fits a large picture inside 3000 px and leaves a small one as it is', async () => {
    const large = await processNoteImage(await solid(4000, 1000).jpeg().toBuffer())
    expect([large.width, large.height]).toEqual([3000, 750])
    const small = await processNoteImage(await solid(300, 200).png().toBuffer())
    expect([small.width, small.height]).toEqual([300, 200])
  })

  test('refuses what is not a PNG, JPEG, WebP or GIF', async () => {
    await expect(processNoteImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow()
  })
})

describe('previews and the assistant copy', () => {
  test('carry none of the stored picture’s metadata', async () => {
    const stored = (await processNoteImage(await cameraJpeg())).bytes
    expect((await sharp(stored).metadata()).exif).toBeDefined()

    expect((await sharp(await resizeNoteImage(stored, 10)).metadata()).exif).toBeUndefined()
    expect((await sharp(await assistantNoteImage(stored)).metadata()).exif).toBeUndefined()
  })
})

/** An MP4-family header: an `ftyp` box, then a `moov` with one track whose `hdlr` names `handler`. */
const mp4 = (brand: string, handler: string) => {
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(8 + body.length, 0)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, body])
  }
  const hdlr = box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler, 'latin1'), Buffer.alloc(13)]))
  return Buffer.concat([
    box('ftyp', Buffer.from(`${brand}\0\0\0\0isommp42`, 'latin1')),
    box('moov', box('trak', box('mdia', hdlr))),
  ])
}

describe('hasMp4VideoTrack', () => {
  test('finds a video handler and not a sound one', () => {
    expect(hasMp4VideoTrack(mp4('isom', 'vide'))).toBe(true)
    expect(hasMp4VideoTrack(mp4('M4A ', 'soun'))).toBe(false)
    expect(hasMp4VideoTrack(Buffer.concat([mp4('M4A ', 'soun'), Buffer.from('hdlr')]))).toBe(false)
  })
})

describe('sniffAudioMime', () => {
  const withTail = (head: number[] | string) =>
    Buffer.concat([
      typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head),
      Buffer.alloc(16),
    ])

  test.each([
    ['WebM', withTail([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm'],
    ['Ogg', withTail('OggS'), 'audio/ogg'],
    ['M4A', withTail('\0\0\0\x20ftypM4A '), 'audio/mp4'],
    ['MP3 with ID3', withTail('ID3\x04'), 'audio/mpeg'],
    ['MP3 frame', withTail([0xff, 0xfb, 0x90, 0x64]), 'audio/mpeg'],
    ['WAV', withTail('RIFF\x24\0\0\0WAVEfmt '), 'audio/wav'],
  ])('knows %s by its first bytes', (_name, bytes, mime) => {
    expect(sniffAudioMime(bytes)).toBe(mime)
  })

  test('keeps an audio-only M4A and refuses an MP4 with a video track', () => {
    expect(sniffAudioMime(mp4('M4A ', 'soun'))).toBe('audio/mp4')
    expect(sniffAudioMime(mp4('isom', 'vide'))).toBeNull()
    expect(sniffAudioMime(Buffer.concat([mp4('mp42', 'soun'), mp4('mp42', 'vide').subarray(24)]))).toBeNull()
  })

  test.each(['heic', 'mif1', 'avif'])('does not take a %s picture for a recording', (brand) => {
    expect(sniffAudioMime(withTail(`\0\0\0\x20ftyp${brand}`))).toBeNull()
  })

  test.each([
    ['WebP (RIFF, not WAVE)', withTail('RIFF\x24\0\0\0WEBPVP8 ')],
    ['JPEG', withTail([0xff, 0xd8, 0xff, 0xe0])],
    ['text', withTail('hello world')],
    ['too short', Buffer.from([0x1a])],
  ])('refuses %s', (_name, bytes) => {
    expect(sniffAudioMime(bytes)).toBeNull()
  })
})

describe('processNoteAttachment', () => {
  test('keeps a recording as it is with the type its bytes say', async () => {
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32, 1)])
    expect(await processNoteAttachment(ogg)).toEqual({ bytes: ogg, kind: 'audio', mime: 'audio/ogg' })
  })

  test('re-encodes a picture and refuses anything else', async () => {
    const picture = await processNoteAttachment(await solid(10, 10).png().toBuffer())
    expect(picture?.mime).toBe('image/webp')
    expect(await processNoteAttachment(Buffer.from('just some text, not a file'))).toBeNull()
  })
})

describe('assistantNoteImage', () => {
  test('hands an assistant a JPEG of at most 2000 px', async () => {
    const stored = await solid(3000, 1500).webp().toBuffer()
    const meta = await sharp(await assistantNoteImage(stored)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 2000, 1000])
  })
})

describe('addNoteAttachment', () => {
  test('stores the processed file through the capped insert', async () => {
    const deps = makeDeps()
    const result = await addNoteAttachment(USER, NOTE_ID, Buffer.from('bytes'), deps)
    expect(result).toMatchObject({ ok: true, value: { kind: 'image', mime: 'image/webp' } })
    expect(deps.insert).toHaveBeenCalledWith(USER, NOTE_ID, expect.objectContaining({ kind: 'image' }))
  })

  test('keeps a picture’s metadata unless the setting says to strip it', async () => {
    const keeps = makeDeps()
    await addNoteAttachment(USER, NOTE_ID, Buffer.from('bytes'), keeps)
    expect(keeps.process).toHaveBeenCalledWith(Buffer.from('bytes'), { stripMetadata: false })

    const strips = makeDeps({ getStripMetadata: vi.fn(async () => true) })
    await addNoteAttachment(USER, NOTE_ID, Buffer.from('bytes'), strips)
    expect(strips.getStripMetadata).toHaveBeenCalledWith(USER)
    expect(strips.process).toHaveBeenCalledWith(Buffer.from('bytes'), { stripMetadata: true })
  })

  test('answers the cap the insert hit when a parallel upload got there first', async () => {
    for (const reason of ['note_limit', 'account_limit'] as const) {
      const deps = makeDeps({ insert: vi.fn(async () => ({ ok: false as const, reason })) })
      expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('bytes'), deps)).toEqual({
        ok: false,
        reason,
      })
    }
  })

  test('only on a live time or day entry', async () => {
    for (const entity_type of ['activity', 'note', 'meal'] as const) {
      const deps = makeDeps({ getNoteById: vi.fn(async () => entry({ entity_type })) })
      expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), deps)).toEqual({
        ok: false,
        reason: 'not_entry',
      })
      expect(deps.insert).not.toHaveBeenCalled()
    }
    const time = makeDeps({ getNoteById: vi.fn(async () => entry({ entity_type: 'time' })) })
    expect((await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), time)).ok).toBe(true)
    const missing = makeDeps({ getNoteById: vi.fn(async () => null) })
    expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), missing)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await addNoteAttachment(USER, 'not-a-uuid', Buffer.from('x'), makeDeps())).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  test('refuses a file over 20 MB', async () => {
    const deps = makeDeps()
    const result = await addNoteAttachment(USER, NOTE_ID, Buffer.alloc(20 * 1024 * 1024 + 1), deps)
    expect(result).toEqual({ ok: false, reason: 'too_large' })
    expect(noteAttachmentFailure('too_large').status).toBe(413)
    expect(deps.process).not.toHaveBeenCalled()
  })

  test('refuses a 31st attachment on an entry', async () => {
    const deps = makeDeps({
      getUsage: vi.fn(async () => ({ account_bytes: 0, live_count: 30, max_position: 40 })),
    })
    expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), deps)).toEqual({
      ok: false,
      reason: 'note_limit',
    })
    expect(noteAttachmentFailure('note_limit').status).toBe(409)
    expect(deps.insert).not.toHaveBeenCalled()
  })

  test('refuses what would take the account past 2 GB', async () => {
    const twoGb = 2 * 1024 * 1024 * 1024
    const full = makeDeps({
      getUsage: vi.fn(async () => ({ account_bytes: twoGb, live_count: 0, max_position: null })),
    })
    expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), full)).toEqual({
      ok: false,
      reason: 'account_limit',
    })
    expect(full.process).not.toHaveBeenCalled()

    expect(noteAttachmentFailure('account_limit').status).toBe(409)
  })

  test('refuses what is neither a picture nor a recording with a 400', async () => {
    const deps = makeDeps({ process: vi.fn(async () => null) })
    expect(await addNoteAttachment(USER, NOTE_ID, Buffer.from('x'), deps)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(noteAttachmentFailure('unsupported')).toEqual({
      message: 'That is not a picture or a recording Aurboda can keep.',
      status: 400,
    })
  })
})

describe('getNoteAttachmentContent', () => {
  test('serves the stored bytes with their type', async () => {
    const deps = makeDeps({
      getAttachment: vi.fn(async () => record({ kind: 'audio', mime: 'audio/ogg' })),
      getBytes: vi.fn(async () => ({ bytes: Buffer.from('ogg'), kind: 'audio', mime: 'audio/ogg' })),
    })
    expect(await getNoteAttachmentContent(USER, NOTE_ID, randomUUID(), 400, deps)).toEqual({
      ok: true,
      value: { bytes: Buffer.from('ogg'), mime: 'audio/ogg' },
    })
    expect(deps.resize).not.toHaveBeenCalled()
  })

  test('downscales a picture once per size', async () => {
    const id = randomUUID()
    const deps = makeDeps({ getAttachment: vi.fn(async () => record({ id })) })
    const first = await getNoteAttachmentContent(USER, NOTE_ID, id, 400, deps)
    const second = await getNoteAttachmentContent(USER, NOTE_ID, id, 400, deps)
    expect(first).toEqual({ ok: true, value: { bytes: Buffer.from('small'), mime: 'image/webp' } })
    expect(second).toEqual(first)
    expect(deps.resize).toHaveBeenCalledTimes(1)
    expect(deps.resize).toHaveBeenCalledWith(Buffer.from('stored'), 400)
    await getNoteAttachmentContent(USER, NOTE_ID, id, 2000, deps)
    expect(deps.resize).toHaveBeenCalledTimes(2)
  })

  test('is not found when the attachment is not the user’s live one', async () => {
    const deps = makeDeps({ getAttachment: vi.fn(async () => null) })
    expect(await getNoteAttachmentContent(USER, NOTE_ID, randomUUID(), 400, deps)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(deps.getBytes).not.toHaveBeenCalled()
  })
})

describe('getNoteAttachmentForAssistant', () => {
  test('a picture comes as a JPEG with its metadata', async () => {
    const deps = makeDeps()
    const result = await getNoteAttachmentForAssistant(USER, NOTE_ID, randomUUID(), deps)
    expect(result).toMatchObject({ ok: true, value: { jpeg: Buffer.from('jpeg'), kind: 'image' } })
    expect(deps.toAssistantImage).toHaveBeenCalledWith(Buffer.from('stored'))
  })

  test('a recording comes as its metadata only', async () => {
    const deps = makeDeps({ getAttachment: vi.fn(async () => record({ kind: 'audio', mime: 'audio/webm' })) })
    const result = await getNoteAttachmentForAssistant(USER, NOTE_ID, randomUUID(), deps)
    expect(result).toMatchObject({ ok: true, value: { attachment: { mime: 'audio/webm' }, kind: 'audio' } })
    expect(deps.getBytes).not.toHaveBeenCalled()
  })
})

describe('deleting and restoring', () => {
  test('a delete is soft unless purged', async () => {
    const deps = makeDeps()
    const id = randomUUID()
    expect(await deleteNoteAttachment(USER, NOTE_ID, id, {}, deps)).toBe(true)
    expect(deps.softDelete).toHaveBeenCalledWith(USER, NOTE_ID, id)
    expect(await deleteNoteAttachment(USER, NOTE_ID, id, { purge: true }, deps)).toBe(true)
    expect(deps.purge).toHaveBeenCalledWith(USER, NOTE_ID, id)
    expect(await deleteNoteAttachment(USER, NOTE_ID, 'nope', {}, deps)).toBe(false)
  })

  test('a restore brings a deleted attachment back', async () => {
    const deps = makeDeps({
      getAttachment: vi.fn(async () => record({ deleted_at: new Date('2026-11-02T08:00:00Z') })),
    })
    const result = await restoreNoteAttachmentById(USER, NOTE_ID, randomUUID(), deps)
    expect(result.ok).toBe(true)
    expect(deps.restore).toHaveBeenCalled()
  })

  test('a restore is refused when the entry already holds 30', async () => {
    const deps = makeDeps({
      getAttachment: vi.fn(async () => record({ deleted_at: new Date('2026-11-02T08:00:00Z') })),
      restore: vi.fn(async () => ({ ok: false as const, reason: 'note_limit' as const })),
    })
    expect(await restoreNoteAttachmentById(USER, NOTE_ID, randomUUID(), deps)).toEqual({
      ok: false,
      reason: 'note_limit',
    })
  })

  test('a live attachment is answered as it is', async () => {
    const deps = makeDeps()
    expect((await restoreNoteAttachmentById(USER, NOTE_ID, randomUUID(), deps)).ok).toBe(true)
    expect(deps.restore).not.toHaveBeenCalled()
  })

  test('the deleted ones carry deleted_at and purge_at 30 days on', async () => {
    const deps = makeDeps({
      listDeleted: vi.fn(async () => [record({ deleted_at: new Date('2026-11-02T08:00:00Z') })]),
    })
    const result = await listDeletedNoteAttachments(USER, NOTE_ID, deps)
    expect(result).toMatchObject({
      ok: true,
      value: [{ deleted_at: '2026-11-02T08:00:00.000Z', purge_at: '2026-12-02T08:00:00.000Z' }],
    })
  })
})
