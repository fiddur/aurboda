/** Mirrors the REST `POST /uploads` capability. */
import { createUploadUrlBodySchema, UPLOAD_URL_TTL_MINUTES } from '@aurboda/api-spec'

import { type TokenBucketLimiter, tooManyRequestsMessage } from '../services/rate-limit.ts'
import { defaultMintUploadUrlDeps, mintUploadUrl, type MintUploadUrlDeps } from '../services/upload-urls.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export interface UploadUrlToolsDeps {
  apiBaseUrl?: string
  /** Replaces the defaults built from `apiBaseUrl`, for tests. */
  mint?: MintUploadUrlDeps
  /** The per-account upload budget the REST upload routes draw on too. */
  uploadLimiter?: TokenBucketLimiter
}

const DESCRIPTION = `Get a short-lived, single-use URL to upload a file to, so the file's bytes never pass through MCP (which carries them base64-encoded, at most about 3 MB). Use it for anything larger than a few hundred kB, or for a file on disk. Targets:
- note_attachment: a picture or a recording (PNG, JPEG, WebP, GIF, HEIC; WebM, Ogg, MP4/M4A, MP3, WAV) attached to a journal entry; needs note_id. Answers like add_note_attachment.
- feed_image: a picture to embed in markdown by its public URL. Answers like add_feed_image.
- challenge_banner: the banner of one of your hosted challenges; needs challenge_id. Answers the updated challenge.
- profile_avatar: your profile picture. Answers its URL.
The URL is good for one upload within ${UPLOAD_URL_TTL_MINUTES} minutes and needs no Authorization header. Send the file's raw bytes with PUT, any content type: \`curl -T <file> '<upload_url>'\`; or as multipart with POST, field \`file\`: \`curl -F file=@<file> '<upload_url>'\`. The upload answers { success, data: { target, ... } } with what the matching tool returns (attachment, image, challenge or url). A file over max_bytes or an empty body leaves the URL usable; any other answer uses it up, so mint a new one to try again. Returns { success, data: { upload_url, expires_at, max_bytes, target, method } }.`

export const registerUploadUrlTools = (server: McpServer, user: string, deps: UploadUrlToolsDeps = {}) => {
  server.tool('create_upload_url', DESCRIPTION, { ...createUploadUrlBodySchema.shape }, async (params) => {
    if (!deps.apiBaseUrl) return errorResponse('Upload URLs are not available')
    const budget = deps.uploadLimiter?.take(user)
    if (budget && !budget.allowed) return errorResponse(tooManyRequestsMessage(budget.retry_after_seconds))
    const result = await mintUploadUrl(user, params, deps.mint ?? defaultMintUploadUrlDeps(deps.apiBaseUrl))
    if (!result.ok) return errorResponse(result.message)
    return jsonResponse({ data: result.value, success: true })
  })
}
