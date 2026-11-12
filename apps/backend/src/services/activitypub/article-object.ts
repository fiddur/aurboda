/**
 * An article federates as a `Note` (built in `deliver.ts`): the title is its
 * `name`, the prose is HTML `content`, and each chart/correlation/challenge/impact block
 * is an attached PNG figure, so a plain fediverse client (Mastodon) shows the
 * prose and the images. (A `Note`, not an AS2 `Article`: Mastodon treats
 * `Article` as a converted type and discards its `content`, rendering only name +
 * link.) Aurboda peers render from the structured-enrichment payload instead; this
 * module builds only the Mastodon-shaped surface: its prose goes through
 * `renderNoteProse` (tables as lines, images as figure references), while the
 * Atom feed keeps the full HTML of `renderProse`.
 */
import type { ArticleContent } from '@aurboda/api-spec'

import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { articleBlockLabel } from '../article.ts'
import { escapeXml } from '../charts/chart-svg.ts'
import { articleBlockFigureSize, FIGURE_BAND_HEIGHT } from '../charts/figure-svg.ts'
import { httpUrl, type NoteProseImage, renderNoteProse, renderProse } from './note-prose.ts'

export { renderProse }

const decodeTextEntities = (text: string): string =>
  text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')

/**
 * Authored markdown as one line of plain text (formatting, links and images
 * dropped, whitespace collapsed) — for a link preview's description.
 */
export const proseToPlainText = (markdown: string): string =>
  decodeTextEntities(
    sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
      allowedAttributes: {},
      allowedTags: [],
    }),
  )
    .replaceAll(/\s+/g, ' ')
    .trim()

export const MASTODON_ATTACHMENT_LIMIT = 4

export interface ArticleFigure {
  /** 1-based, document order. */
  number: number
  /** Caption, else the block's label (`articleBlockLabel`); a prose image's alt text ('' when none). */
  label: string
  url: string
  /** Index in `article.blocks` for a block figure; absent for a prose image. */
  block_index?: number
  width?: number
  height?: number
  media_type?: string
}

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const mediaTypeOf = (url: URL): string | undefined => {
  const extension = /\.([a-z0-9]+)$/i.exec(url.pathname)?.[1]?.toLowerCase()
  return extension === undefined ? undefined : IMAGE_MEDIA_TYPES[extension]
}

/** A figure's plain-text name: `Figure N: label`, or `Figure N` without a label. */
export const articleFigureName = (figure: Pick<ArticleFigure, 'label' | 'number'>): string =>
  figure.label ? `Figure ${figure.number}: ${figure.label}` : `Figure ${figure.number}`

/**
 * The escaped reference to a figure in the Note text. Past Mastodon's attachment
 * limit the words `Figure N` link to the image, since Mastodon will not show it.
 */
const figureReference = (figure: ArticleFigure): string => {
  const words = `Figure ${figure.number}`
  const lead =
    figure.number > MASTODON_ATTACHMENT_LIMIT ? `<a href="${escapeXml(figure.url)}">${words}</a>` : words
  return figure.label ? `${lead}: ${escapeXml(figure.label)}` : lead
}

/**
 * The article Note's `content` HTML and the figures it attaches, from one walk
 * so the numbering in the text and on the attachments can't disagree.
 *
 * The **title** leads the `content` as a bold paragraph because Mastodon's status
 * parser ignores a Note's `name` (it only falls back to `name` for *converted*
 * object types like Article), so a title left only in `name` never renders.
 *
 * Every image the Note attaches is a numbered figure, counted in document order:
 * each non-prose block (its image is `blockFigureUrl(index)`) and each prose
 * image with an http(s) `src`. Mastodon lays attachments out after the text, so
 * the text carries `Figure N: label` where the image stood. A caption is plain
 * escaped text, not markdown, as on the web's `<figcaption>`. A challenge block
 * adds a "Join the challenge" link after its reference.
 */
export const renderArticleNote = (
  article: ArticleContent,
  blockFigureUrl: (blockIndex: number) => string,
): { content: string; figures: ArticleFigure[] } => {
  const figures: ArticleFigure[] = []
  const addFigure = (figure: Omit<ArticleFigure, 'number'>): ArticleFigure => {
    const numbered = { ...figure, number: figures.length + 1 }
    figures.push(numbered)
    return numbered
  }
  const proseImage = ({ alt, src }: NoteProseImage): string => {
    const url = httpUrl(src)
    if (url == null) return escapeXml(alt)
    const figure = addFigure({ label: alt, media_type: mediaTypeOf(url), url: src })
    return `<em>${figureReference(figure)}</em>`
  }
  const heading = `<p><strong>${escapeXml(article.title)}</strong></p>`
  const body = article.blocks
    .map((block, index) => {
      if (block.type === 'prose') return renderNoteProse(block.markdown, { image: proseImage })
      const { height, width } = articleBlockFigureSize(block.type)
      const figure = addFigure({
        block_index: index,
        height: height + FIGURE_BAND_HEIGHT,
        label: articleBlockLabel(block),
        media_type: 'image/png',
        url: blockFigureUrl(index),
        width,
      })
      const reference = `<p><em>${figureReference(figure)}</em></p>`
      if (block.type !== 'challenge') return reference
      return `${reference}\n<p><a href="${escapeXml(block.challenge_url)}">Join the challenge</a></p>`
    })
    .filter((html) => html.length > 0)
    .join('\n')
  return { content: body.length > 0 ? `${heading}\n${body}` : heading, figures }
}
