import { useState } from 'preact/hooks'

import { canNativeShare, canWriteClipboard, isAbortError } from './share-link'
import './ShareControls.css'

const iconProps = {
  'aria-hidden': true,
  fill: 'none',
  height: 18,
  stroke: 'currentColor',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'stroke-width': 2,
  viewBox: '0 0 24 24',
  width: 18,
} as const

export const GlobeIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

const LinkIcon = () => (
  <svg {...iconProps}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

const ShareSheetIcon = () => (
  <svg {...iconProps}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
)

export const ShareArrowIcon = () => (
  <svg {...iconProps}>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </svg>
)

/** Copies `url`, falling back to a prompt where the clipboard API is missing (instances served over plain http). */
export function useCopyLink(url: string): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      if (canWriteClipboard(navigator)) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        window.prompt('Copy this link:', url)
      }
    } catch {
      window.prompt('Copy this link:', url)
    }
  }
  return { copied, copy }
}

export function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const { copied, copy } = useCopyLink(url)
  return (
    <>
      <button type="button" class="icon-button" onClick={copy} aria-label={label} title={label}>
        <LinkIcon />
      </button>
      {copied && (
        <span class="copy-link-feedback" role="status">
          Copied!
        </span>
      )}
    </>
  )
}

export function NativeShareButton({ url, title }: { url: string; title?: string }) {
  if (typeof navigator === 'undefined' || !canNativeShare(navigator)) return null

  const share = async () => {
    try {
      await navigator.share({ title, url })
    } catch (err) {
      if (!isAbortError(err)) console.error('Share failed', err)
    }
  }

  return (
    <button type="button" class="icon-button" onClick={share} aria-label="Share…" title="Share…">
      <ShareSheetIcon />
    </button>
  )
}
