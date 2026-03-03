import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { auth, logout } from '../state/auth'

const DATA_SOURCE_LINKS = [
  { label: 'Overview', path: '/data-sources' },
  { label: 'Aurboda (Web / API)', path: '/data-sources/aurboda' },
  { label: 'Aurboda Android', path: '/data-sources/android-app' },
  { label: 'Oura Ring', path: '/data-sources/oura' },
  { label: 'ActivityWatch (Desktop)', path: '/data-sources/activitywatch-desktop' },
  { label: 'ActivityWatch (Android)', path: '/data-sources/activitywatch-android' },
  { label: 'RescueTime', path: '/data-sources/rescue-time' },
  { label: 'Last.fm', path: '/data-sources/lastfm' },
  { label: 'OwnTracks', path: '/data-sources/owntracks' },
  { label: 'Calendars', path: '/data-sources/calendars' },
]

const NAV_LINKS = [
  { href: '/goals', label: 'Goals' },
  { href: '/hr-zones', label: 'HR Zones' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/add', label: '+ Add' },
  { href: '/trends', label: 'Trends' },
  { href: '/places', label: 'Places' },
]

const NavLink = ({ href, label, url }: { href: string; label: string; url: string }) => (
  <a href={href} class={url === href ? 'active' : undefined}>
    {label}
  </a>
)

export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.is_admin

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isDataSourcesActive = url.startsWith('/data-sources')

  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }

  const toggleDropdown = useCallback(
    (e: Event) => {
      e.preventDefault()
      setDropdownOpen(!dropdownOpen)
    },
    [dropdownOpen],
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [dropdownOpen])

  // Close dropdown on navigation
  useEffect(() => {
    setDropdownOpen(false)
  }, [url])

  return (
    <header>
      <nav>
        <a href="/" class={url === '/' ? 'active' : undefined}>
          Home
        </a>
        {isLoggedIn ?
          <>
            {NAV_LINKS.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} url={url} />
            ))}
            <div class={`nav-dropdown ${isDataSourcesActive ? 'active' : ''}`} ref={dropdownRef}>
              <a
                href="/data-sources"
                class={isDataSourcesActive ? 'active dropdown-toggle' : 'dropdown-toggle'}
                onClick={toggleDropdown}
              >
                Data Sources <span class="dropdown-arrow">{dropdownOpen ? '\u25B4' : '\u25BE'}</span>
              </a>
              {dropdownOpen && (
                <div class="dropdown-menu">
                  {DATA_SOURCE_LINKS.map((link) => (
                    <a key={link.path} href={link.path} class={url === link.path ? 'active' : ''}>
                      {link.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {isAdmin && (
              <a href="/admin" class={url === '/admin' ? 'active' : undefined}>
                Admin
              </a>
            )}
            <span class="spacer" />
            <a href="/settings" class={url === '/settings' ? 'active user-link' : 'user-link'}>
              {auth.value.user}
            </a>
            <a href="#" onClick={handleLogout} class="logout-link">
              Logout
            </a>
          </>
        : <a href="/login" class={url === '/login' ? 'active' : undefined}>
            Login
          </a>
        }
      </nav>
    </header>
  )
}
