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
  { href: '/data', label: 'Data' },
  { href: '/add', label: '+ Add' },
  { href: '/trends', label: 'Trends' },
  { href: '/places', label: 'Places' },
]

// eslint-disable-next-line complexity -- navigation component with many branches
export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.is_admin

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dsExpandedInDrawer, setDsExpandedInDrawer] = useState(false)
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

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // Close desktop dropdown when clicking outside
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

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [drawerOpen])

  // Close dropdown and drawer on navigation
  useEffect(() => {
    setDropdownOpen(false)
    setDrawerOpen(false)
  }, [url])

  return (
    <header>
      {/* ── Desktop nav ─────────────────────────────────────── */}
      <nav class="nav-desktop">
        <a href="/" class={url === '/' ? 'active' : undefined}>
          Home
        </a>
        {isLoggedIn ? (
          <>
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} class={url === link.href ? 'active' : undefined}>
                {link.label}
              </a>
            ))}
            <div class={`nav-dropdown${isDataSourcesActive ? ' active' : ''}`} ref={dropdownRef}>
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
        ) : (
          <a href="/login" class={url === '/login' ? 'active' : undefined}>
            Login
          </a>
        )}
      </nav>

      {/* ── Mobile nav bar (hamburger) ───────────────────────── */}
      <nav class="nav-mobile">
        <a href="/" class={`nav-mobile-home${url === '/' ? ' active' : ''}`}>
          Home
        </a>
        <span class="spacer" />
        <button
          class="hamburger-btn"
          onClick={toggleDrawer}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          type="button"
        >
          ☰
        </button>
      </nav>

      {/* ── Drawer backdrop ──────────────────────────────────── */}
      {drawerOpen && <div class="drawer-backdrop" onClick={closeDrawer} />}

      {/* ── Left drawer ─────────────────────────────────────── */}
      <nav class={`nav-drawer${drawerOpen ? ' open' : ''}`} aria-hidden={!drawerOpen}>
        <div class="drawer-header">
          <span class="drawer-title">Menu</span>
          <button class="drawer-close-btn" onClick={closeDrawer} aria-label="Close menu" type="button">
            ✕
          </button>
        </div>
        {isLoggedIn ? (
          <>
            <a href="/" class={url === '/' ? 'active' : undefined} onClick={closeDrawer}>
              Home
            </a>
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                class={url === link.href ? 'active' : undefined}
                onClick={closeDrawer}
              >
                {link.label}
              </a>
            ))}
            {/* Data Sources inline expand */}
            <button
              class={`drawer-section-toggle${isDataSourcesActive ? ' active' : ''}`}
              onClick={() => setDsExpandedInDrawer((v) => !v)}
              type="button"
            >
              Data Sources <span class="dropdown-arrow">{dsExpandedInDrawer ? '\u25B4' : '\u25BE'}</span>
            </button>
            {dsExpandedInDrawer &&
              DATA_SOURCE_LINKS.map((link) => (
                <a
                  key={link.path}
                  href={link.path}
                  class={`drawer-sub-link${url === link.path ? ' active' : ''}`}
                  onClick={closeDrawer}
                >
                  {link.label}
                </a>
              ))}
            {isAdmin && (
              <a href="/admin" class={url === '/admin' ? 'active' : undefined} onClick={closeDrawer}>
                Admin
              </a>
            )}
            <div class="drawer-spacer" />
            <a
              href="/settings"
              class={url === '/settings' ? 'active user-link' : 'user-link'}
              onClick={closeDrawer}
            >
              {auth.value.user}
            </a>
            <a href="#" onClick={handleLogout} class="logout-link">
              Logout
            </a>
          </>
        ) : (
          <a href="/login" class={url === '/login' ? 'active' : undefined} onClick={closeDrawer}>
            Login
          </a>
        )}
      </nav>
    </header>
  )
}
