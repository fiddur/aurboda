/**
 * The single markdown → HTML render path for the web app.
 *
 * `marked` passes raw HTML in the source straight through, so it is NOT a
 * sanitiser — **DOMPurify is the XSS boundary**. Every place that renders
 * markdown into `dangerouslySetInnerHTML` MUST go through `renderMarkdown` (never
 * call `marked.parse` directly at a sink), so sanitisation is centralised and
 * can't be forgotten at a new sink. This matters as soon as a sink renders
 * markdown authored by a *different* user (shared reports, articles, public
 * pages) — an unsanitised `<img src=x onerror=…>` in someone else's note would be
 * stored XSS.
 */
import type { PostMention } from '@aurboda/api-spec'

import { canPrecedeHandle, handleAtStart, handleKey, handleStartIndex } from '@aurboda/api-spec'
import DOMPurify, { type DOMPurify as Purifier } from 'dompurify'
import { Marked, type MarkedExtension, type Tokens } from 'marked'

import { attachmentIdOf } from './attachment-ref'

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// A private attachment cannot be an `<img src>` (the bytes need the token, and the sanitisers below drop
// non-http sources), so `attachment:<uuid>` becomes a source-less `<img>` carrying the id for the page
// to fill in.
const attachmentImages: MarkedExtension = {
  renderer: {
    image({ href, text }) {
      const id = attachmentIdOf(href)
      if (id === undefined) return false
      return `<img data-attachment-id="${id}" alt="${escapeAttribute(text)}">`
    },
  },
}

interface HandleToken extends Tokens.Generic {
  type: 'handle'
  raw: string
  handle: string
}

// A typed `@user@host` is its own token ahead of GFM's e-mail autolink, as on the backend
// (`note-prose.ts`): a mention the post stores links to the account, any other handle is plain
// text, never a `mailto:` link.
const handleMentions = (mentions: readonly PostMention[]): MarkedExtension => {
  const byHandle = new Map(mentions.map((mention) => [handleKey(mention.handle), mention.actor_uri]))
  return {
    extensions: [
      {
        level: 'inline',
        name: 'handle',
        renderer(token) {
          const { handle } = token as HandleToken
          const href = byHandle.get(handleKey(handle))
          const text = escapeAttribute(handle)
          return href === undefined ? text : `<a href="${escapeAttribute(href)}">${text}</a>`
        },
        start: (src: string) => handleStartIndex(src),
        tokenizer(src, tokens): HandleToken | undefined {
          if (this.lexer.state.inLink) return undefined
          const match = handleAtStart(src)
          if (match == null || !canPrecedeHandle(tokens.at(-1)?.raw.at(-1))) return undefined
          return { handle: match.handle, raw: match.handle, type: 'handle' }
        },
      },
    ],
  }
}

// GFM + hard line breaks, shared by every sink. `async: false` keeps `parse` returning a string.
const markedWith = (mentions: readonly PostMention[]): Marked =>
  new Marked({ async: false, breaks: true, gfm: true }, attachmentImages, handleMentions(mentions))

const plainMarked = markedWith([])

const parseMarkdown = (md: string, mentions: readonly PostMention[]): string =>
  (mentions.length === 0 ? plainMarked : markedWith(mentions)).parse(md, { async: false })

// Brought in line with the outbound article sanitiser (backend
// `services/activitypub/article-object.ts`), so what the web shows is what
// federates: no form controls (a post could otherwise draw a
// credential-looking form on this origin), no styling, and images from http(s)
// only — no data: images and no same-origin GETs via a relative src.
const OWN_FORBID_TAGS = ['form', 'input', 'button', 'select', 'textarea', 'style']
const OWN_FORBID_ATTR = ['style', 'srcset']

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim())

const keepHttpImagesOnly = (node: Element): void => {
  if (node.nodeName === 'IMG' && !isHttpUrl(node.getAttribute('src') ?? '')) node.removeAttribute('src')
}

// Its own instance, because DOMPurify hooks are global to an instance and this
// one must not touch `renderRemoteMarkdown` or any other sanitiser. Created on
// first use: DOMPurify needs a window.
let ownPurifier: Purifier | undefined
const ownContentPurifier = (): Purifier => {
  if (!ownPurifier) {
    ownPurifier = DOMPurify(window)
    ownPurifier.addHook('afterSanitizeAttributes', keepHttpImagesOnly)
  }
  return ownPurifier
}

/**
 * Render user/AI-authored markdown to sanitised HTML safe for a `dangerouslySetInnerHTML` sink. A
 * typed `@user@host` among `mentions` links to its account; any other is plain text.
 */
export const renderMarkdown = (md: string, mentions: readonly PostMention[] = []): string =>
  ownContentPurifier().sanitize(parseMarkdown(md, mentions), {
    FORBID_ATTR: OWN_FORBID_ATTR,
    FORBID_TAGS: OWN_FORBID_TAGS,
  })

// The allowlist for REMOTE (peer-authored) markdown — a stricter *superset* of the
// backend's inbound `sanitizeRemoteHtml` allowlist (it adds the GFM table tags
// `table`/`thead`/`tbody`/`tr`/`th`/`td`), so both inbound-federation surfaces
// enforce essentially one policy. Crucially it has NO media tags: a one-item
// `FORBID_TAGS: ['img']` denylist on DOMPurify's broad default would still let a
// remote peer smuggle a tracking pixel via `<style background-image>`, `<video
// poster>`, `<audio>/<source srcset>`, `<svg><image href>` or `<input type=image>`.
// An inline remote image is kept only when the post's payload declares its URL.
// Links are additionally hardened by `hardenRemoteLink` below (the backend does the
// same via `transformTags`), so allowing `rel`/`target` here can't leave them off.
const REMOTE_ALLOWED_TAGS = [
  'p',
  'br',
  'a',
  'span',
  'em',
  'strong',
  'b',
  'i',
  'del',
  's',
  'u',
  'pre',
  'code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]
const REMOTE_ALLOWED_ATTR = ['href', 'rel', 'target', 'class', 'translate', 'start']

/**
 * Harden every link in remote prose exactly as the backend's inbound
 * `sanitizeRemoteHtml` does: force `rel="nofollow noopener noreferrer"` and
 * `target="_blank"`. `marked` emits bare `<a href>` (no rel/target), so without
 * this a federated peer's prose would leak a `Referer` to the link target and
 * carry no `nofollow`/`noopener` — unlike the same peer's HTML on the same card.
 */
const hardenRemoteLink = (node: Element): void => {
  if (node.nodeName === 'A') {
    node.setAttribute('rel', 'nofollow noopener noreferrer')
    node.setAttribute('target', '_blank')
  }
}

const REMOTE_IMAGE_ATTR = ['src', 'alt']

export interface DeclaredImage {
  url: string
}

const normalisedHttpUrl = (value: string): string | null => {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

const keepDeclaredImages =
  (declared: ReadonlySet<string>) =>
  (node: Element): void => {
    if (node.nodeName !== 'IMG') return
    const src = normalisedHttpUrl(node.getAttribute('src') ?? '')
    if (src == null || !declared.has(src)) {
      node.remove()
      return
    }
    for (const name of node.getAttributeNames()) {
      if (!REMOTE_IMAGE_ATTR.includes(name)) node.removeAttribute(name)
    }
    node.setAttribute('loading', 'lazy')
    node.setAttribute('referrerpolicy', 'no-referrer')
  }

/**
 * Sanitise REMOTE (or remote-shaped) HTML under the same strict allowlist and link
 * hardening. An `<img>` survives only when its http(s) `src` is one of `images`.
 */
export const sanitizeRemoteHtml = (html: string, images: readonly DeclaredImage[] = []): string => {
  const declared = new Set(images.flatMap(({ url }) => normalisedHttpUrl(url) ?? []))
  const keepImage = declared.size > 0 ? keepDeclaredImages(declared) : null
  const hook = (node: Element): void => {
    hardenRemoteLink(node)
    keepImage?.(node)
  }
  // The hook is scoped to this one synchronous sanitise: added, used, and removed
  // with no `await` between, so it never leaks onto `renderMarkdown` (own content,
  // which shouldn't be force-`nofollow`ed) or a later call without images.
  DOMPurify.addHook('afterSanitizeAttributes', hook)
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_ATTR: keepImage ? [...REMOTE_ALLOWED_ATTR, ...REMOTE_IMAGE_ATTR] : REMOTE_ALLOWED_ATTR,
      ALLOWED_TAGS: keepImage ? [...REMOTE_ALLOWED_TAGS, 'img'] : REMOTE_ALLOWED_TAGS,
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook)
  }
}

/**
 * Render markdown authored by a REMOTE peer (e.g. a federated article's prose) to
 * sanitised HTML under the strict `REMOTE_ALLOWED_*` allowlist above — an
 * XSS-and-tracker boundary for untrusted federated content, mirroring the backend
 * `sanitizeRemoteHtml`. Use this (not `renderMarkdown`) for any markdown that
 * originates on another instance. Only the pictures in `images` (the payload's
 * declared ones) are drawn inline, and only the handles in `mentions` are links.
 */
export const renderRemoteMarkdown = (
  md: string,
  images: readonly DeclaredImage[] = [],
  mentions: readonly PostMention[] = [],
): string => sanitizeRemoteHtml(parseMarkdown(md, mentions), images)
