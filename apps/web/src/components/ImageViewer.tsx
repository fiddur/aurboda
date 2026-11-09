import type { ComponentChildren } from 'preact'

import { useEffect, useRef, useState } from 'preact/hooks'

import './ImageViewer.css'
import { opensImageViewer } from './image-viewer'

function ImageViewerDialog({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      class="image-viewer"
      aria-label={caption}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
    >
      <img src={src} alt={caption} />
      <p class="image-viewer-caption">{caption}</p>
      <button
        type="button"
        class="image-viewer-close"
        aria-label="Close"
        onClick={() => dialogRef.current?.close()}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </dialog>
  )
}

/**
 * A link to a full-size image that a plain click opens in an in-page viewer instead. Modified and
 * middle clicks, and visitors without JavaScript, follow the link as usual.
 */
export function ImageViewerLink({
  href,
  caption,
  className,
  children,
}: {
  href: string
  caption: string
  className?: string
  children: ComponentChildren
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <a
        href={href}
        class={className}
        onClick={(e) => {
          if (!opensImageViewer(e)) return
          e.preventDefault()
          // The router listens for clicks on window and would otherwise navigate to the image.
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {children}
      </a>
      {open && <ImageViewerDialog src={href} caption={caption} onClose={() => setOpen(false)} />}
    </>
  )
}
