/**
 * Pictures and recordings on journal entries. A picture is re-encoded on the way in (upright, at
 * most NOTE_IMAGE_MAX_EDGE px, WebP), keeping its metadata unless the owner's
 * `journal_strip_metadata` setting says to remove it (a HEIC has none left once decoded); a
 * recording is kept as it was recorded, once its first bytes say it is one of the accepted
 * containers. Attachments are only ever reached through their live entry, so deleting, restoring
 * or purging the entry needs nothing here.
 */
import {
  DELETED_NOTE_RETENTION_DAYS,
  isFreeStandingNoteType,
  MAX_ATTACHMENTS_PER_NOTE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_ATTACHMENT_MCP_IMAGE_EDGE,
  NOTE_ATTACHMENTS_ACCOUNT_BYTES,
  NOTE_IMAGE_MAX_EDGE,
  type NoteAttachment,
  type NoteAudioMime,
} from '@aurboda/api-spec'
import heicDecode, { type DecodedHeicImage, type HeicImages } from 'heic-decode'
import sharp, { type Sharp } from 'sharp'

import {
  getDeletedNoteAttachments,
  getNoteAttachment,
  getNoteAttachmentBytes,
  getNoteAttachmentsForNoteIds,
  getNoteAttachmentUsage,
  getNoteById,
  getUserSettings,
  insertNoteAttachmentWithinLimits,
  type NewNoteAttachment,
  type Note,
  type NoteAttachmentLimitResult,
  type NoteAttachmentRecord,
  type NoteAttachmentUsage,
  purgeNoteAttachment,
  restoreNoteAttachmentWithinLimit,
  softDeleteNoteAttachment,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { assertAllowedFormat, MAX_UPLOAD_PIXELS, uploadedImage } from './avatar.ts'
import { createRenderCache } from './render-cache.ts'

const DAY_MS = 24 * 60 * 60 * 1000

export const toNoteAttachmentData = (record: NoteAttachmentRecord): NoteAttachment => ({
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString(),
  height: record.height,
  id: record.id,
  kind: record.kind,
  mime: record.mime,
  position: record.position,
  purge_at: record.deleted_at
    ? new Date(record.deleted_at.getTime() + DELETED_NOTE_RETENTION_DAYS * DAY_MS).toISOString()
    : undefined,
  size: record.size,
  width: record.width,
})

const ascii = (buffer: Buffer, start: number, end: number): string =>
  buffer.subarray(start, end).toString('latin1')

const isMpegFrameSync = (buffer: Buffer): boolean =>
  buffer.length >= 2 &&
  buffer[0] === 0xff &&
  (buffer[1] & 0xe0) === 0xe0 &&
  ((buffer[1] >> 3) & 0x03) !== 0x01 &&
  ((buffer[1] >> 1) & 0x03) !== 0x00

/** HEIC and AVIF pictures share the MP4 container's `ftyp` box: they are pictures, not recordings. */
const PICTURE_FTYP_BRANDS = new Set([
  'avif',
  'avis',
  'heic',
  'heim',
  'heis',
  'heix',
  'hevc',
  'hevm',
  'hevs',
  'hevx',
  'mif1',
  'msf1',
])

const HDLR = Buffer.from('hdlr', 'latin1')

/**
 * Whether an MP4-family file has a video track: a `hdlr` box (after its type come 4 bytes of
 * version and flags and 4 of pre_defined) naming the `vide` handler. The `moov` box may sit after
 * the media data, so the whole buffer is scanned.
 */
export const hasMp4VideoTrack = (buffer: Buffer): boolean => {
  for (let at = buffer.indexOf(HDLR); at !== -1; at = buffer.indexOf(HDLR, at + 1)) {
    if (ascii(buffer, at + 12, at + 16) === 'vide') return true
  }
  return false
}

/** The audio container the first bytes name, or null when they name none Aurboda keeps. */
export const sniffAudioMime = (buffer: Buffer): NoteAudioMime | null => {
  if (buffer.length < 4) return null
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm'
  if (ascii(buffer, 0, 4) === 'OggS') return 'audio/ogg'
  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') {
    if (PICTURE_FTYP_BRANDS.has(ascii(buffer, 8, 12)) || hasMp4VideoTrack(buffer)) return null
    return 'audio/mp4'
  }
  const riff = buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF'
  if (riff && ascii(buffer, 8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(buffer, 0, 3) === 'ID3' || isMpegFrameSync(buffer)) return 'audio/mpeg'
  return null
}

/**
 * HEVC-coded HEIF brands. `mif1`/`msf1` alone do not count: AVIF names them too, and an AVIF also
 * names `avif`, never one of these.
 */
const HEVC_FTYP_BRANDS = new Set(['heic', 'heim', 'heis', 'heix', 'hevc', 'hevm', 'hevs', 'hevx'])

/** Whether the `ftyp` box's major or a compatible brand says HEVC-coded HEIF, which sharp cannot decode. */
export const isHeic = (buffer: Buffer): boolean => {
  if (buffer.length < 12 || ascii(buffer, 4, 8) !== 'ftyp') return false
  if (HEVC_FTYP_BRANDS.has(ascii(buffer, 8, 12))) return true
  const end = Math.min(buffer.readUInt32BE(0), buffer.length)
  for (let at = 16; at + 4 <= end; at += 4) {
    if (HEVC_FTYP_BRANDS.has(ascii(buffer, at, at + 4))) return true
  }
  return false
}

export type DecodeHeicImages = (input: { buffer: Uint8Array }) => Promise<HeicImages>

/**
 * The first top-level picture of a HEIC file as RGBA, already turned and mirrored as the file says.
 * Its size is checked before any pixel is decoded, against the same ceiling as every other upload.
 */
export const decodeHeic = async (
  buffer: Buffer,
  decodeAll: DecodeHeicImages = heicDecode.all,
): Promise<DecodedHeicImage> => {
  const images = await decodeAll({ buffer })
  try {
    const [primary] = images
    if (!primary) throw new Error('HEIC file has no picture')
    if (primary.width * primary.height > MAX_UPLOAD_PIXELS) {
      throw new Error(`HEIC picture too large: ${primary.width}x${primary.height}`)
    }
    return await primary.decode()
  } finally {
    images.dispose()
  }
}

/**
 * The picture to re-encode, upright. A HEIC goes through the WASM decoder, since the bundled libvips
 * has no HEVC; it carries no EXIF once decoded, so nothing of it is kept. Anything else must be a
 * PNG, JPEG, WebP or GIF, and `.rotate()` applies its EXIF orientation and resets the tag to 1, so
 * a viewer does not turn the kept picture a second time.
 */
const uprightPicture = async (buffer: Buffer): Promise<Sharp> => {
  if (!isHeic(buffer)) {
    await assertAllowedFormat(buffer)
    return uploadedImage(buffer).rotate()
  }
  const { data, height, width } = await decodeHeic(buffer)
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    limitInputPixels: MAX_UPLOAD_PIXELS,
    raw: { channels: 4, height, width },
  })
}

export interface NoteImageOptions {
  /** Drop the EXIF (time, camera, GPS position), ICC and XMP metadata instead of keeping it. */
  stripMetadata: boolean
}

/**
 * Throws when the bytes are not a PNG, JPEG, WebP, GIF or HEIC, whatever the client claimed. sharp
 * writes no metadata unless asked to, so stripping is leaving it out.
 */
export const processNoteImage = async (
  buffer: Buffer,
  { stripMetadata }: NoteImageOptions = { stripMetadata: false },
): Promise<NewNoteAttachment> => {
  const upright = await uprightPicture(buffer)
  const { data, info } = await (stripMetadata ? upright : upright.keepMetadata())
    .resize({
      fit: 'inside',
      height: NOTE_IMAGE_MAX_EDGE,
      width: NOTE_IMAGE_MAX_EDGE,
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true })
  return { bytes: data, height: info.height, kind: 'image', mime: 'image/webp', width: info.width }
}

/** What to store for an uploaded file, or null when it is neither a picture nor a recording Aurboda keeps. */
export const processNoteAttachment = async (
  buffer: Buffer,
  options: NoteImageOptions = { stripMetadata: false },
): Promise<NewNoteAttachment | null> => {
  const audio = sniffAudioMime(buffer)
  if (audio) return { bytes: buffer, kind: 'audio', mime: audio }
  try {
    return await processNoteImage(buffer, options)
  } catch {
    return null
  }
}

/** A picture fitted inside `edge` px, as WebP, without the stored picture's metadata. */
export const resizeNoteImage = async (bytes: Buffer, edge: number): Promise<Buffer> =>
  uploadedImage(bytes)
    .resize({ fit: 'inside', height: edge, width: edge, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

/** A picture as an assistant reads it: JPEG, every model client takes it, at most 2000 px, no metadata. */
export const assistantNoteImage = async (bytes: Buffer): Promise<Buffer> =>
  uploadedImage(bytes)
    .resize({
      fit: 'inside',
      height: NOTE_ATTACHMENT_MCP_IMAGE_EDGE,
      width: NOTE_ATTACHMENT_MCP_IMAGE_EDGE,
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer()

export interface NoteAttachmentDeps {
  getNoteById: (user: string, id: string) => Promise<Note | null>
  getUsage: (user: string, noteId: string) => Promise<NoteAttachmentUsage>
  getStripMetadata: (user: string) => Promise<boolean>
  /** Numbers the attachment after the entry's highest position, under the caps, serialized per account. */
  insert: (
    user: string,
    noteId: string,
    attachment: NewNoteAttachment,
  ) => Promise<NoteAttachmentLimitResult<NoteAttachmentRecord>>
  process: (buffer: Buffer, options: NoteImageOptions) => Promise<NewNoteAttachment | null>
  getAttachment: (
    user: string,
    noteId: string,
    id: string,
    options?: { include_deleted?: boolean },
  ) => Promise<NoteAttachmentRecord | null>
  getBytes: (
    user: string,
    noteId: string,
    id: string,
  ) => Promise<{ kind: string; mime: string; bytes: Buffer } | null>
  listDeleted: (user: string, noteId: string) => Promise<NoteAttachmentRecord[]>
  listLive: (user: string, noteIds: string[]) => Promise<Map<string, NoteAttachmentRecord[]>>
  softDelete: (user: string, noteId: string, id: string) => Promise<boolean>
  purge: (user: string, noteId: string, id: string) => Promise<boolean>
  restore: (
    user: string,
    noteId: string,
    id: string,
  ) => Promise<NoteAttachmentLimitResult<NoteAttachmentRecord> | null>
  resize: (bytes: Buffer, edge: number) => Promise<Buffer>
  toAssistantImage: (bytes: Buffer) => Promise<Buffer>
}

const NOTE_ATTACHMENT_LIMITS = {
  account_bytes: NOTE_ATTACHMENTS_ACCOUNT_BYTES,
  per_note: MAX_ATTACHMENTS_PER_NOTE,
}

export const defaultNoteAttachmentDeps: NoteAttachmentDeps = {
  getAttachment: (user, noteId, id, options) => getNoteAttachment(user, noteId, id, options),
  getBytes: (user, noteId, id) => getNoteAttachmentBytes(user, noteId, id),
  getNoteById: (user, id) => getNoteById(user, id),
  getStripMetadata: async (user) => (await getUserSettings(user))?.journal_strip_metadata === true,
  getUsage: (user, noteId) => getNoteAttachmentUsage(user, noteId),
  insert: (user, noteId, attachment) =>
    insertNoteAttachmentWithinLimits(user, noteId, attachment, NOTE_ATTACHMENT_LIMITS),
  listDeleted: (user, noteId) => getDeletedNoteAttachments(user, noteId),
  listLive: (user, noteIds) => getNoteAttachmentsForNoteIds(user, noteIds),
  process: processNoteAttachment,
  purge: (user, noteId, id) => purgeNoteAttachment(user, noteId, id),
  resize: resizeNoteImage,
  restore: (user, noteId, id) =>
    restoreNoteAttachmentWithinLimit(user, noteId, id, NOTE_ATTACHMENT_LIMITS.per_note),
  softDelete: (user, noteId, id) => softDeleteNoteAttachment(user, noteId, id),
  toAssistantImage: assistantNoteImage,
}

export type NoteAttachmentFailure =
  | 'not_found'
  | 'not_entry'
  | 'too_large'
  | 'note_limit'
  | 'account_limit'
  | 'unsupported'

export type NoteAttachmentResult<T> = { ok: true; value: T } | { ok: false; reason: NoteAttachmentFailure }

const MB = 1024 * 1024

const FAILURES: Record<NoteAttachmentFailure, { status: number; message: string }> = {
  account_limit: {
    message: `Your pictures and recordings already take up all the room one account has (${NOTE_ATTACHMENTS_ACCOUNT_BYTES / 1024 / MB} GB). Delete some first; deleted ones count until they are removed for good.`,
    status: 409,
  },
  not_entry: { message: 'Pictures and recordings can only be added to a journal entry.', status: 400 },
  not_found: { message: 'Not found', status: 404 },
  note_limit: {
    message: `An entry can hold ${MAX_ATTACHMENTS_PER_NOTE} pictures and recordings. Delete one first.`,
    status: 409,
  },
  too_large: {
    message: `That file is too large (at most ${NOTE_ATTACHMENT_MAX_BYTES / MB} MB).`,
    status: 413,
  },
  unsupported: { message: 'That is not a picture or a recording Aurboda can keep.', status: 400 },
}

export const noteAttachmentFailure = (reason: NoteAttachmentFailure): { status: number; message: string } =>
  FAILURES[reason]

const fail = <T>(reason: NoteAttachmentFailure): NoteAttachmentResult<T> => ({ ok: false, reason })

/** The live journal entry the attachments hang off, or why there is none. */
export const findAttachmentEntry = async (
  user: string,
  noteId: string,
  deps: NoteAttachmentDeps,
): Promise<NoteAttachmentFailure | Note> => {
  if (!UUID_RE.test(noteId)) return 'not_found'
  const note = await deps.getNoteById(user, noteId)
  if (!note) return 'not_found'
  if (!isFreeStandingNoteType(note.entity_type)) return 'not_entry'
  return note
}

export const addNoteAttachment = async (
  user: string,
  noteId: string,
  buffer: Buffer,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<NoteAttachment>> => {
  const entry = await findAttachmentEntry(user, noteId, deps)
  if (typeof entry === 'string') return fail(entry)
  if (buffer.length > NOTE_ATTACHMENT_MAX_BYTES) return fail('too_large')
  const [usage, stripMetadata] = await Promise.all([deps.getUsage(user, noteId), deps.getStripMetadata(user)])
  if (usage.live_count >= MAX_ATTACHMENTS_PER_NOTE) return fail('note_limit')
  if (usage.account_bytes >= NOTE_ATTACHMENTS_ACCOUNT_BYTES) return fail('account_limit')
  const processed = await deps.process(buffer, { stripMetadata })
  if (!processed) return fail('unsupported')
  const inserted = await deps.insert(user, noteId, processed)
  return inserted.ok ? { ok: true, value: toNoteAttachmentData(inserted.value) } : fail(inserted.reason)
}

const previewCache = createRenderCache<Buffer>(100)

/**
 * The bytes to serve for an attachment, a picture downscaled to `maxEdge` when asked (memoised:
 * an attachment's bytes never change). The owner check comes first, so the cache only ever
 * answers its owner.
 */
export const getNoteAttachmentContent = async (
  user: string,
  noteId: string,
  id: string,
  maxEdge: number | undefined,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<{ mime: string; bytes: Buffer }>> => {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(id)) return fail('not_found')
  const attachment = await deps.getAttachment(user, noteId, id)
  if (!attachment) return fail('not_found')
  if (attachment.kind === 'image' && maxEdge !== undefined) {
    const bytes = await previewCache(`${user}:${id}:${maxEdge}`, async () => {
      const stored = await deps.getBytes(user, noteId, id)
      return stored ? deps.resize(stored.bytes, maxEdge) : null
    })
    return bytes ? { ok: true, value: { bytes, mime: 'image/webp' } } : fail('not_found')
  }
  const stored = await deps.getBytes(user, noteId, id)
  return stored ? { ok: true, value: { bytes: stored.bytes, mime: stored.mime } } : fail('not_found')
}

export type AssistantNoteAttachment =
  | { kind: 'image'; attachment: NoteAttachment; jpeg: Buffer }
  | { kind: 'audio'; attachment: NoteAttachment }

/** An attachment as handed to an assistant: a picture as a JPEG of at most 2000 px, a recording as its metadata. */
export const getNoteAttachmentForAssistant = async (
  user: string,
  noteId: string,
  id: string,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<AssistantNoteAttachment>> => {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(id)) return fail('not_found')
  const record = await deps.getAttachment(user, noteId, id)
  if (!record) return fail('not_found')
  const attachment = toNoteAttachmentData(record)
  if (record.kind === 'audio') return { ok: true, value: { attachment, kind: 'audio' } }
  const stored = await deps.getBytes(user, noteId, id)
  if (!stored) return fail('not_found')
  return { ok: true, value: { attachment, jpeg: await deps.toAssistantImage(stored.bytes), kind: 'image' } }
}

/** Delete an attachment, restorable until the daily prune; `purge` removes it for good at once. */
export const deleteNoteAttachment = async (
  user: string,
  noteId: string,
  id: string,
  options: { purge?: boolean } = {},
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<boolean> => {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(id)) return false
  return options.purge ? deps.purge(user, noteId, id) : deps.softDelete(user, noteId, id)
}

/** Bring back a deleted attachment, unless the entry already holds as many as it may. */
export const restoreNoteAttachmentById = async (
  user: string,
  noteId: string,
  id: string,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<NoteAttachment>> => {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(id)) return fail('not_found')
  const existing = await deps.getAttachment(user, noteId, id, { include_deleted: true })
  if (!existing) return fail('not_found')
  if (!existing.deleted_at) return { ok: true, value: toNoteAttachmentData(existing) }
  const restored = await deps.restore(user, noteId, id)
  if (!restored) return fail('not_found')
  return restored.ok ? { ok: true, value: toNoteAttachmentData(restored.value) } : fail(restored.reason)
}

/** A live entry's deleted attachments, newest deletion first, with deleted_at and purge_at. */
export const listDeletedNoteAttachments = async (
  user: string,
  noteId: string,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<NoteAttachment[]>> => {
  const entry = await findAttachmentEntry(user, noteId, deps)
  if (typeof entry === 'string') return fail(entry)
  const deleted = await deps.listDeleted(user, noteId)
  return { ok: true, value: deleted.map(toNoteAttachmentData) }
}

/** A live entry's live attachments, in page order. */
export const listNoteAttachments = async (
  user: string,
  noteId: string,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<NoteAttachment[]>> => {
  const entry = await findAttachmentEntry(user, noteId, deps)
  if (typeof entry === 'string') return fail(entry)
  const live = await deps.listLive(user, [noteId])
  return { ok: true, value: (live.get(noteId) ?? []).map(toNoteAttachmentData) }
}
