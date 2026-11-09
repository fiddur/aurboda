import { useEffect } from 'preact/hooks'

import { officialFeedPath } from '../state/api/blogUrls'
import { ensureStatusLoaded, officialFeedEnabled } from '../state/auth'

/** The licence, legal and help links; the welcome page adds a tagline beside them. */
export function Footer({ tagline }: { tagline?: string }) {
  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  return (
    <footer class={`site-footer${tagline ? ' site-footer-with-tagline' : ''}`}>
      {tagline && <p>{tagline}</p>}
      <p>
        <a href="https://github.com/fiddur/aurboda">Aurboda</a> ©Fredrik Liljegren {new Date().getFullYear()}{' '}
        <a href="http://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</a> · <a href="/privacy">Privacy</a>{' '}
        · <a href="/terms">Terms</a> · <a href="/help">Help &amp; support</a>
        {officialFeedEnabled.value && (
          <>
            {' · '}
            <a href={officialFeedPath}>Blog</a>
          </>
        )}
      </p>
    </footer>
  )
}
