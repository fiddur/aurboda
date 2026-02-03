import { useLocation } from 'preact-iso'
import { auth, logout } from '../state/auth'

export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.isAdmin

  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }

  return (
    <header>
      <nav>
        <a href="/" class={url == '/' && 'active'}>
          Home
        </a>
        {isLoggedIn ?
          <>
            <a href="/goals" class={url == '/goals' && 'active'}>
              Goals
            </a>
            <a href="/hr-zones" class={url == '/hr-zones' && 'active'}>
              HR Zones
            </a>
            <a href="/timeline" class={url == '/timeline' && 'active'}>
              Timeline
            </a>
            <a href="/trends" class={url == '/trends' && 'active'}>
              Trends
            </a>
            <a href="/places" class={url == '/places' && 'active'}>
              Places
            </a>
            {isAdmin && (
              <a href="/admin" class={url == '/admin' && 'active'}>
                Admin
              </a>
            )}
            <span class="spacer" />
            <a href="/settings" class={url == '/settings' ? 'active user-link' : 'user-link'}>
              {auth.value.user}
            </a>
            <a href="#" onClick={handleLogout} class="logout-link">
              Logout
            </a>
          </>
        : <a href="/login" class={url == '/login' && 'active'}>
            Login
          </a>
        }
      </nav>
    </header>
  )
}
