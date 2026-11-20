/**
 * Pictures and recordings on journal entries. A picture is re-encoded on the way in (upright, no
 * metadata, at most NOTE_IMAGE_MAX_EDGE px, WebP); a recording is kept as it was recorded, once
 * its first bytes say it is one of the accepted containers. Attachments are only ever reached
 * through their live entry, so deleting, restoring or purging the entry needs nothing here.
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

import {
  getDeletedNoteAttachments,
  getNoteAttachment,
  getNoteAttachmentBytes,
  getNoteAttachmentsForNoteIds,
  getNoteAttachmentUsage,
  getNoteById,
  insertNoteAttachment,
  type NewNoteAttachment,
  type Note,
  type NoteAttachmentRecord,
  type NoteAttachmentUsage,
  purgeNoteAttachment,
  restoreNoteAttachment,
  softDeleteNoteAttachment,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { assertAllowedFormat, uploadedImage } from './avatar.ts'
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

/** HEIC and AVIF pictures share the MP4 container's `ftyp` box; kept as "audio" they would skip the re-encoding that drops a picture's metadata. */
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

/** The audio container the first bytes name, or null when they name none Aurboda keeps. */
export const sniffAudioMime = (buffer: Buffer): NoteAudioMime | null => {
  if (buffer.length < 4) return null
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm'
  if (ascii(buffer, 0, 4) === 'OggS') return 'audio/ogg'
  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') {
    return PICTURE_FTYP_BRANDS.has(ascii(buffer, 8, 12)) ? null : 'audio/mp4'
  }
  const riff = buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF'
  if (riff && ascii(buffer, 8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(buffer, 0, 3) === 'ID3' || isMpegFrameSync(buffer)) return 'audio/mpeg'
  return null
}

/**
 * Throws when the bytes are not a PNG, JPEG, WebP or GIF, whatever the client claimed. `.rotate()`
 * applies the EXIF orientation, and sharp writes no metadata unless asked to, so the camera and
 * GPS position are dropped.
 */
export const processNoteImage = async (buffer: Buffer): Promise<NewNoteAttachment> => {
  await assertAllowedFormat(buffer)
  const { data, info } = await uploadedImage(buffer)
    .rotate()
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
export const processNoteAttachment = async (buffer: Buffer): Promise<NewNoteAttachment | null> => {
  const audio = sniffAudioMime(buffer)
  if (audio) return { bytes: buffer, kind: 'audio', mime: audio }
  try {
    return await processNoteImage(buffer)
  } catch {
    return null
  }
}

/** A picture fitted inside `edge` px, as WebP. */
export const resizeNoteImage = async (bytes: Buffer, edge: number): Promise<Buffer> =>
  uploadedImage(bytes)
    .resize({ fit: 'inside', height: edge, width: edge, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

/** A picture as an assistant reads it: JPEG, every model client takes it, at most 2000 px. */
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
  insert: (
    user: string,
    noteId: string,
    position: number,
    attachment: NewNoteAttachment,
  ) => Promise<NoteAttachmentRecord>
  process: (buffer: Buffer) => Promise<NewNoteAttachment | null>
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
  restore: (user: string, noteId: string, id: string) => Promise<NoteAttachmentRecord | null>
  resize: (bytes: Buffer, edge: number) => Promise<Buffer>
  toAssistantImage: (bytes: Buffer) => Promise<Buffer>
}

export const defaultNoteAttachmentDeps: NoteAttachmentDeps = {
  getAttachment: (user, noteId, id, options) => getNoteAttachment(user, noteId, id, options),
  getBytes: (user, noteId, id) => getNoteAttachmentBytes(user, noteId, id),
  getNoteById: (user, id) => getNoteById(user, id),
  getUsage: (user, noteId) => getNoteAttachmentUsage(user, noteId),
  insert: (user, noteId, position, attachment) => insertNoteAttachment(user, noteId, position, attachment),
  listDeleted: (user, noteId) => getDeletedNoteAttachments(user, noteId),
  listLive: (user, noteIds) => getNoteAttachmentsForNoteIds(user, noteIds),
  process: processNoteAttachment,
  purge: (user, noteId, id) => purgeNoteAttachment(user, noteId, id),
  resize: resizeNoteImage,
  restore: (user, noteId, id) => restoreNoteAttachment(user, noteId, id),
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
const findEntry = async (
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
  const entry = await findEntry(user, noteId, deps)
  if (typeof entry === 'string') return fail(entry)
  if (buffer.length > NOTE_ATTACHMENT_MAX_BYTES) return fail('too_large')
  const usage = await deps.getUsage(user, noteId)
  if (usage.live_count >= MAX_ATTACHMENTS_PER_NOTE) return fail('note_limit')
  if (usage.account_bytes >= NOTE_ATTACHMENTS_ACCOUNT_BYTES) return fail('account_limit')
  const processed = await deps.process(buffer)
  if (!processed) return fail('unsupported')
  const accountBytes = usage.account_bytes + processed.bytes.length
  if (accountBytes > NOTE_ATTACHMENTS_ACCOUNT_BYTES) return fail('account_limit')
  const record = await deps.insert(user, noteId, (usage.max_position ?? 0) + 1, processed)
  return { ok: true, value: toNoteAttachmentData(record) }
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
  const usage = await deps.getUsage(user, noteId)
  if (usage.live_count >= MAX_ATTACHMENTS_PER_NOTE) return fail('note_limit')
  const restored = await deps.restore(user, noteId, id)
  return restored ? { ok: true, value: toNoteAttachmentData(restored) } : fail('not_found')
}

/** A live entry's deleted attachments, newest deletion first, with deleted_at and purge_at. */
export const listDeletedNoteAttachments = async (
  user: string,
  noteId: string,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): Promise<NoteAttachmentResult<NoteAttachment[]>> => {
  const entry = await findEntry(user, noteId, deps)
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
  const entry = await findEntry(user, noteId, deps)
  if (typeof entry === 'string') return fail(entry)
  const live = await deps.listLive(user, [noteId])
  return { ok: true, value: (live.get(noteId) ?? []).map(toNoteAttachmentData) }
}
