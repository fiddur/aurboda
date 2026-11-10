/** The public tag pages (`/tags/<tag>`): public posts with a hashtag, from this server and others. */
import { publicTagPath } from '../state/api/blogUrls'

export const publicTagSummary = (tag: string, retentionDays: number): string =>
  `Public posts tagged #${tag}, from this server and others, from the last ${retentionDays} ${
    retentionDays === 1 ? 'day' : 'days'
  }`

export interface TagLink {
  tag: string
  /** The tag's page, or null when it has none. */
  href: string | null
}

/** A post's tags, each linking to its page when it has one. */
export const tagLinks = (postTags: readonly string[], pages: readonly string[]): TagLink[] =>
  postTags.map((tag) => ({ href: pages.includes(tag) ? publicTagPath(tag) : null, tag }))
