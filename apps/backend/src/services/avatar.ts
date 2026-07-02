/**
 * Avatar processing and fallback generation.
 *
 * Uploaded images are normalized to a square 256×256 WebP (small, consistent,
 * strips metadata). Users without an uploaded avatar get a deterministic
 * identicon derived from their username — a font-free SVG rasterized by sharp,
 * so it needs no bundled fonts and always renders.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'

/** Output size (px) of both processed avatars and generated identicons. */
export const AVATAR_SIZE = 256

const ALLOWED_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// The formats sharp must actually detect. Guards against Content-Type spoofing
// (e.g. SVG bytes sent as image/png), since sharp would otherwise rasterize the
// real bytes regardless of the claimed mimetype.
const ALLOWED_DETECTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])

export const isAllowedAvatarType = (contentType: string): boolean => ALLOWED_UPLOAD_TYPES.has(contentType)

export interface StoredImage {
  content_type: string
  data: Buffer
}

/**
 * Normalize an uploaded avatar to a square 256×256 WebP. Throws if the buffer
 * isn't a decodable raster image of an allowed format (caller maps that to a
 * 400) — the format is checked against what sharp actually detects, not the
 * client-claimed mimetype, so SVG can't slip through by Content-Type spoofing.
 */
export const processAvatar = async (buffer: Buffer): Promise<StoredImage> => {
  const { format } = await sharp(buffer).metadata()
  if (!format || !ALLOWED_DETECTED_FORMATS.has(format)) {
    throw new Error(`Unsupported image format: ${format ?? 'unknown'}`)
  }
  const data = await sharp(buffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer()
  return { content_type: 'image/webp', data }
}

/** Deterministic hue (0–359) from a seed string. */
const hueFromSeed = (bytes: Buffer): number => ((bytes[0] << 8) | bytes[1]) % 360

/**
 * Build a GitHub-style symmetric 5×5 identicon SVG for a seed. Columns are
 * mirrored across the vertical axis; a byte per left/centre cell decides fill.
 */
const identiconSvg = (seed: string): string => {
  const bytes = createHash('sha256').update(seed).digest()
  const hue = hueFromSeed(bytes)
  const fg = `hsl(${hue} 55% 52%)`
  const bg = `hsl(${hue} 30% 94%)`

  const cells: string[] = []
  // Columns 0..2 are the left half + centre; 3,4 mirror 1,0.
  for (let col = 0; col <= 2; col++) {
    for (let row = 0; row < 5; row++) {
      // One bit per cell from the hash (offset past the 2 hue bytes).
      if ((bytes[2 + col * 5 + row] & 1) === 0) continue
      const mirrored = 4 - col
      cells.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`)
      if (mirrored !== col) cells.push(`<rect x="${mirrored}" y="${row}" width="1" height="1"/>`)
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}">` +
    `<rect width="5" height="5" fill="${bg}"/>` +
    `<g fill="${fg}">${cells.join('')}</g>` +
    `</svg>`
  )
}

/** Render a deterministic identicon PNG for a seed (username). */
export const generateIdenticon = async (seed: string): Promise<StoredImage> => {
  const data = await sharp(Buffer.from(identiconSvg(seed)))
    .png()
    .toBuffer()
  return { content_type: 'image/png', data }
}
