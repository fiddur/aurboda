/**
 * Short-lived, single-use upload URLs: an authenticated call mints one bound to a target, and the
 * bytes then arrive at it without an Authorization header, the URL being the credential. Only the
 * token's SHA-256 is stored, so a leaked database row cannot be turned back into a working URL.
 */
import {
  type CreateUploadUrlBody,
  MAX_FEED_IMAGE_BYTES,
  NOTE_ATTACHMENT_MAX_BYTES,
  type NoteAttachment,
  UPLOAD_URL_TTL_MINUTES,
  type UploadResultResponse,
  type UploadTarget,
  type UploadUrl,
} from '@aurboda/api-spec'
import { createHash, randomBytes } from 'node:crypto'

import type { NewUploadUrl, UploadUrlRecord } from '../db/index.ts'

import { getChallengeById, insertUploadUrl } from '../db/index.ts'
import {
  CHALLENGE_BANNER_MAX_BYTES,
  setChallengeBanner,
  type SetChallengeBannerResult,
} from './challenge-banner.ts'
import { serializeChallenge } from './challenge-serialize.ts'
import {
  ADD_FEED_IMAGE_FAILURE_STATUS,
  addFeedImage,
  addFeedImageFailureMessage,
  type AddFeedImageResult,
  defaultAddFeedImageDeps,
  PICTURE_TOO_LARGE_MESSAGE,
  serializeFeedImage,
} from './feed-image.ts'
import {
  addNoteAttachment,
  defaultNoteAttachmentDeps,
  findAttachmentEntry,
  type NoteAttachmentFailure,
  noteAttachmentFailure,
  type NoteAttachmentResult,
} from './note-attachments.ts'
import { PROFILE_AVATAR_MAX_BYTES, setProfileAvatar, type SetProfileAvatarResult } from './profile-avatar.ts'

export const UPLOAD_MAX_BYTES: Record<UploadTarget, number> = {
  challenge_banner: CHALLENGE_BANNER_MAX_BYTES,
  feed_image: MAX_FEED_IMAGE_BYTES,
  note_attachment: NOTE_ATTACHMENT_MAX_BYTES,
  profile_avatar: PROFILE_AVATAR_MAX_BYTES,
}

export const uploadTooLargeMessage = (target: UploadTarget): string =>
  target === 'note_attachment'
    ? noteAttachmentFailure('too_large').message
    : target === 'feed_image'
      ? PICTURE_TOO_LARGE_MESSAGE
      : 'File too large'

export const UPLOAD_URL_GONE_MESSAGE = 'This upload URL is unknown, expired or already used'

const TOKEN_BYTES = 32
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** The shape of a minted token: 32 bytes, base64url without padding. */
export const isUploadToken = (token: string): boolean => TOKEN_RE.test(token)

export const hashUploadToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const uploadUrlFor = (apiBaseUrl: string, user: string, token: string): string =>
  `${apiBaseUrl}/uploads/${encodeURIComponent(user)}/${token}`

type TargetIdField = 'note_id' | 'challenge_id'

const TARGET_ID_FIELD: Record<UploadTarget, TargetIdField | null> = {
  challenge_banner: 'challenge_id',
  feed_image: null,
  note_attachment: 'note_id',
  profile_avatar: null,
}

const ID_FIELDS: TargetIdField[] = ['challenge_id', 'note_id']

export interface MintUploadUrlDeps {
  apiBaseUrl: string
  now: () => Date
  randomBytes: (size: number) => Buffer
  insert: (user: string, url: NewUploadUrl) => Promise<unknown>
  /** Why the note cannot take an attachment, or null when it is a live journal entry. */
  noteEntryFailure: (user: string, noteId: string) => Promise<NoteAttachmentFailure | null>
  challengeExists: (user: string, challengeId: string) => Promise<boolean>
}

export const defaultMintUploadUrlDeps = (apiBaseUrl: string): MintUploadUrlDeps => ({
  apiBaseUrl,
  challengeExists: async (user, challengeId) => (await getChallengeById(user, challengeId)) !== null,
  insert: (user, url) => insertUploadUrl(user, url),
  now: () => new Date(),
  noteEntryFailure: async (user, noteId) => {
    const entry = await findAttachmentEntry(user, noteId, defaultNoteAttachmentDeps)
    return typeof entry === 'string' ? entry : null
  },
  randomBytes,
})

export type MintUploadUrlResult =
  | { ok: true; value: UploadUrl }
  | { ok: false; status: 400 | 404; message: string }

const refuse = (status: 400 | 404, message: string): MintUploadUrlResult => ({ message, ok: false, status })

/** Why the target cannot take an upload for these ids, or null when it can. */
const targetRefusal = async (
  user: string,
  body: CreateUploadUrlBody,
  deps: MintUploadUrlDeps,
): Promise<MintUploadUrlResult | null> => {
  const field = TARGET_ID_FIELD[body.target]
  const unexpected = ID_FIELDS.find((other) => other !== field && body[other] !== undefined)
  if (unexpected) return refuse(400, `${body.target} takes no ${unexpected}`)
  if (field === null) return null
  const id = body[field]
  if (id === undefined) return refuse(400, `${body.target} needs a ${field}`)
  if (field === 'challenge_id') {
    return (await deps.challengeExists(user, id)) ? null : refuse(404, 'Challenge not found')
  }
  const failure = await deps.noteEntryFailure(user, id)
  if (!failure) return null
  const { message, status } = noteAttachmentFailure(failure)
  return refuse(status === 404 ? 404 : 400, message)
}

export const mintUploadUrl = async (
  user: string,
  body: CreateUploadUrlBody,
  deps: MintUploadUrlDeps,
): Promise<MintUploadUrlResult> => {
  const refusal = await targetRefusal(user, body, deps)
  if (refusal) return refusal
  const field = TARGET_ID_FIELD[body.target]
  const token = deps.randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(deps.now().getTime() + UPLOAD_URL_TTL_MINUTES * 60_000)
  await deps.insert(user, {
    expires_at: expiresAt,
    target: body.target,
    target_id: field === null ? null : (body[field] ?? null),
    token_hash: hashUploadToken(token),
  })
  return {
    ok: true,
    value: {
      expires_at: expiresAt.toISOString(),
      max_bytes: UPLOAD_MAX_BYTES[body.target],
      method: 'PUT',
      target: body.target,
      upload_url: uploadUrlFor(deps.apiBaseUrl, user, token),
    },
  }
}

export interface UploadHandlers {
  note_attachment: (
    user: string,
    noteId: string,
    buffer: Buffer,
  ) => Promise<NoteAttachmentResult<NoteAttachment>>
  feed_image: (user: string, buffer: Buffer) => Promise<AddFeedImageResult>
  challenge_banner: (user: string, challengeId: string, buffer: Buffer) => Promise<SetChallengeBannerResult>
  profile_avatar: (user: string, buffer: Buffer) => Promise<SetProfileAvatarResult>
}

export const defaultUploadHandlers = (webHost: string): UploadHandlers => ({
  challenge_banner: (user, challengeId, buffer) => setChallengeBanner(user, challengeId, buffer),
  feed_image: (user, buffer) => addFeedImage(user, buffer, defaultAddFeedImageDeps),
  note_attachment: (user, noteId, buffer) => addNoteAttachment(user, noteId, buffer),
  profile_avatar: (user, buffer) => setProfileAvatar(user, buffer, webHost),
})

export interface RunUploadDeps {
  apiBaseUrl: string
  webHost: string
  handlers: UploadHandlers
  /** Fire-and-forget: federate an `Update{Person}` after the profile picture changed. */
  onProfileChanged?: (user: string) => void
}

export interface UploadOutcome {
  status: number
  body: UploadResultResponse
}

const failed = (status: number, error: string): UploadOutcome => ({ body: { error, success: false }, status })

const stored = (data: NonNullable<UploadResultResponse['data']>): UploadOutcome => ({
  body: { data, success: true },
  status: 201,
})

const CHALLENGE_NOT_FOUND = 'Challenge not found'
const UNPROCESSABLE_IMAGE = 'Could not process image'

/** Hands the bytes of a spent URL to its target and answers what the target's own upload would. */
export const runUpload = async (
  user: string,
  url: Pick<UploadUrlRecord, 'target' | 'target_id'>,
  buffer: Buffer,
  deps: RunUploadDeps,
): Promise<UploadOutcome> => {
  switch (url.target) {
    case 'note_attachment': {
      if (!url.target_id) return failed(404, UPLOAD_URL_GONE_MESSAGE)
      const result = await deps.handlers.note_attachment(user, url.target_id, buffer)
      if (!result.ok) {
        const { message, status } = noteAttachmentFailure(result.reason)
        return failed(status, message)
      }
      return stored({ attachment: result.value, target: 'note_attachment' })
    }
    case 'feed_image': {
      const result = await deps.handlers.feed_image(user, buffer)
      if (!result.ok) {
        return failed(ADD_FEED_IMAGE_FAILURE_STATUS[result.reason], addFeedImageFailureMessage(result.reason))
      }
      return stored({ image: serializeFeedImage(deps.apiBaseUrl, user, result.image), target: 'feed_image' })
    }
    case 'challenge_banner': {
      if (!url.target_id) return failed(404, UPLOAD_URL_GONE_MESSAGE)
      const result = await deps.handlers.challenge_banner(user, url.target_id, buffer)
      if (!result.ok) {
        return result.reason === 'not_found'
          ? failed(404, CHALLENGE_NOT_FOUND)
          : failed(400, UNPROCESSABLE_IMAGE)
      }
      return stored({
        challenge: serializeChallenge(result.record, deps.webHost, user),
        target: 'challenge_banner',
      })
    }
    case 'profile_avatar': {
      const result = await deps.handlers.profile_avatar(user, buffer)
      if (!result.ok) return failed(400, UNPROCESSABLE_IMAGE)
      deps.onProfileChanged?.(user)
      return stored({ target: 'profile_avatar', url: result.url })
    }
  }
}
