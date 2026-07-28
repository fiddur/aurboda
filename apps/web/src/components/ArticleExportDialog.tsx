/**
 * Reddit/markdown export (C4): fetch an article's paste-ready markdown (title +
 * prose + one image link per chart/correlation block) and let the user copy it
 * for pasting into a text-only destination like r/QuantifiedSelf, adding their
 * own write-up around the linked charts.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchArticleExport } from '../state/api'
import './ArticleEditorDialog.css' // for `.article-input`
import './ShareActivityDialog.css'

export const ArticleExportDialog = ({ postId, onClose }: { postId: string; onClose: () => void }) => {
  const { data, isLoading, isError, error } = useQuery({
    queryFn: () => fetchArticleExport(postId),
    queryKey: ['article-export', postId],
    // Every failure this route produces is deterministic (400 for a non-public
    // article, 404, 503), never transient — so surface it immediately instead of
    // letting the default `retry: 3` stall on "Loading…" through exponential backoff.
    retry: false,
  })
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — the
      // textarea below is still there to select-and-copy manually.
    }
  }

  return (
    <div class="share-dialog-backdrop" onClick={onClose}>
      <div class="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="share-dialog-header">
          <h2>Export markdown</h2>
          <button type="button" class="share-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p class="share-dialog-note">
          Paste this into r/QuantifiedSelf or a similar text-only destination — add your own write-up around
          the linked charts.
        </p>

        {isLoading && <p>Loading…</p>}
        {isError && (
          <p class="share-dialog-error">
            {error instanceof Error ? error.message : 'Couldn’t export this article. Please try again.'}
          </p>
        )}
        {data && (
          <>
            <textarea
              class="article-input"
              readOnly
              rows={16}
              value={data}
              onClick={(e) => e.currentTarget.select()}
            />
            <div class="share-dialog-actions">
              <button type="button" class="btn-primary" onClick={copy}>
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
              <button type="button" class="btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
