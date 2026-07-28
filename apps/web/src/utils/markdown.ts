/**
 * The single markdown → HTML render path for the web app.
 *
 * `marked` passes raw HTML in the source straight through, so it is NOT a
 * sanitiser — **DOMPurify is the XSS boundary**. Every place that renders
 * markdown into `dangerouslySetInnerHTML` MUST go through `renderMarkdown` (never
 * call `marked.parse` directly at a sink), so sanitisation is centralised and
 * can't be forgotten at a new sink (#910). This matters as soon as a sink renders
 * markdown authored by a *different* user (shared reports, articles, public
 * pages) — an unsanitised `<img src=x onerror=…>` in someone else's note would be
 * stored XSS.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

// GFM + hard line breaks, shared by every sink (previously set ad-hoc in the
// editor). `async: false` keeps `parse` returning a string, not a Promise.
marked.setOptions({ breaks: true, gfm: true })

/** Render user/AI-authored markdown to sanitised HTML safe for a `dangerouslySetInnerHTML` sink. */
export const renderMarkdown = (md: string): string => DOMPurify.sanitize(marked.parse(md, { async: false }))

// The allowlist for REMOTE (peer-authored) markdown — a stricter *superset* of the
// backend's inbound `sanitizeRemoteHtml` allowlist (it adds the GFM table tags
// `table`/`thead`/`tbody`/`tr`/`th`/`td`), so both inbound-federation surfaces
// enforce essentially one policy. Crucially it has NO media tags: a one-item
// `FORBID_TAGS: ['img']` denylist on DOMPurify's broad default would still let a
// remote peer smuggle a tracking pixel via `<style background-image>`, `<video
// poster>`, `<audio>/<source srcset>`, `<svg><image href>` or `<input type=image>`.
// Remote images arrive only via the post's declared attachment list, never inline.
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

/**
 * Render markdown authored by a REMOTE peer (e.g. a federated article's prose) to
 * sanitised HTML under the strict `REMOTE_ALLOWED_*` allowlist above — an
 * XSS-and-tracker boundary for untrusted federated content, mirroring the backend
 * `sanitizeRemoteHtml`. Use this (not `renderMarkdown`) for any markdown that
 * originates on another instance.
 */
export const renderRemoteMarkdown = (md: string): string => {
  // The link-hardening hook is scoped to this one synchronous sanitise: added,
  // used, and removed with no `await` between, so it never leaks onto
  // `renderMarkdown` (own content, which shouldn't be force-`nofollow`ed).
  DOMPurify.addHook('afterSanitizeAttributes', hardenRemoteLink)
  try {
    return DOMPurify.sanitize(marked.parse(md, { async: false }), {
      ALLOWED_ATTR: REMOTE_ALLOWED_ATTR,
      ALLOWED_TAGS: REMOTE_ALLOWED_TAGS,
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}
