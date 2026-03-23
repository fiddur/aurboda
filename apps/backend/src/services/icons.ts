/**
 * Icon upload processing — resize and compress images to fit within 256KB.
 */
import sharp from 'sharp'

import { deleteIcon, insertIcon } from '../db/icons.ts'

const MAX_ICON_BYTES = 256 * 1024
const MAX_ICON_PIXELS = 256

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])

export const isAllowedContentType = (contentType: string): boolean => ALLOWED_CONTENT_TYPES.has(contentType)

/**
 * Process an uploaded image buffer:
 * - SVG: stored as-is if within size limit
 * - Raster: stored as-is if within size limit, otherwise resized to 256×256 and compressed
 * - Animated GIF/PNG: animation frames are preserved during resize
 *
 * Returns { data, contentType } of the processed image.
 * Throws if the image cannot be compressed to fit within 256KB.
 */
export const processIcon = async (
  buffer: Buffer,
  contentType: string,
): Promise<{ data: Buffer; content_type: string }> => {
  if (!isAllowedContentType(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`)
  }

  // SVG: store as-is, just check size
  if (contentType === 'image/svg+xml') {
    if (buffer.length > MAX_ICON_BYTES) {
      throw new Error(`SVG exceeds ${MAX_ICON_BYTES} bytes (${buffer.length} bytes)`)
    }
    return { data: buffer, content_type: contentType }
  }

  // Raster: if already small enough, store as-is
  if (buffer.length <= MAX_ICON_BYTES) {
    return { data: buffer, content_type: contentType }
  }

  // Need to resize and compress
  const isAnimated = contentType === 'image/gif' || contentType === 'image/png'
  let pipeline = sharp(buffer, { animated: isAnimated }).resize(MAX_ICON_PIXELS, MAX_ICON_PIXELS, {
    fit: 'inside',
    withoutEnlargement: true,
  })

  // Compress based on format
  if (contentType === 'image/png') {
    pipeline = pipeline.png({ compressionLevel: 9 })
  } else if (contentType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 80 })
  } else if (contentType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 80 })
  } else if (contentType === 'image/gif') {
    pipeline = pipeline.gif()
  }

  const processed = await pipeline.toBuffer()

  if (processed.length > MAX_ICON_BYTES) {
    throw new Error(`Image still exceeds ${MAX_ICON_BYTES} bytes after resize (${processed.length} bytes)`)
  }

  return { data: processed, content_type: contentType }
}

/**
 * Process and store an uploaded icon image.
 * Returns the icon UUID.
 */
export const processAndStoreIcon = async (
  user: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> => {
  const processed = await processIcon(buffer, contentType)
  return insertIcon(user, processed.content_type, processed.data)
}

/**
 * Delete an uploaded icon.
 */
export const removeIcon = async (user: string, id: string): Promise<boolean> => deleteIcon(user, id)
