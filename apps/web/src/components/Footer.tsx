import { useEffect } from 'preact/hooks'

import { blogPath } from '../state/api/blogUrls'
import { blogUsername, ensureStatusLoaded } from '../state/auth'

export function Footer() {
  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  const blogUser = blogUsername.value

  return (
    <footer class="site-footer">
      <p>
        <a href="https://github.com/fiddur/aurboda">Aurboda</a> ©Fredrik Liljegren {new Date().getFullYear()}{' '}
        <a href="http://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</a> · <a href="/privacy">Privacy</a>{' '}
        · <a href="/terms">Terms</a> ·{' '}
        <a href="https://github.com/fiddur/aurboda/discussions">Feedback &amp; questions</a>
        {blogUser && (
          <>
            {' · '}
            <a href={blogPath(blogUser)}>Blog</a>
          </>
        )}
      </p>
    </footer>
  )
}
