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
