import type { ArticlePreviewAttachment } from '@aurboda/api-spec'

/** Mastodon's web UI folds a status whose text is taller than this in timelines. */
export const MASTODON_FOLD_HEIGHT = 706

export type MastodonGridLayout = 'four' | 'single' | 'three' | 'two'

/** How Mastodon's web UI lays out a status's images, by how many it shows. */
export const mastodonGridLayout = (count: number): MastodonGridLayout => {
  if (count <= 1) return 'single'
  if (count === 2) return 'two'
  return count === 3 ? 'three' : 'four'
}

/** The image a preview cell shows: the drawn figure, a prose image's own URL, or null (nothing to draw). */
export const attachmentImageSrc = (attachment: ArticlePreviewAttachment): string | null => {
  if (attachment.image_svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(attachment.image_svg)}`
  }
  if (attachment.image_svg === null) return null
  return attachment.url ?? null
}
