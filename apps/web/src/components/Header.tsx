import { useLocation } from 'preact-iso'
import { auth } from '../state/auth'
import { Auth } from './Auth'

export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token

  return (
    <header>
      <Auth />
      <nav>
        <a href="/" class={url == '/' && 'active'}>
          Home
        </a>
        {isLoggedIn && (
          <a href="/timeline" class={url == '/timeline' && 'active'}>
            Timeline
          </a>
        )}
      </nav>
    </header>
  )
}
