import { useState } from 'preact/hooks'

/**
 * Share control for public pages: uses the native share sheet
 * (`navigator.share`, mainly mobile) when available, otherwise copies the link
 * to the clipboard with brief "Copied!" feedback.
 */
export function ShareLinkButton({ url, title }: { url: string; title?: string }) {
  const [copied, setCopied] = useState(false)

  const onClick = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // User cancelled or share failed — fall through to clipboard copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing more we can do.
    }
  }

  return (
    <button type="button" class="share-link-btn" onClick={onClick} title="Share this page">
      {copied ? 'Copied!' : 'Share'}
    </button>
  )
}
