import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { auth, logout } from '../state/auth'
import { DATA_SOURCE_LINKS, NAV_LINKS } from './nav-links'

// eslint-disable-next-line complexity -- navigation component with many branches
export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const isAdmin = auth.value.is_admin

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dsExpandedInDrawer, setDsExpandedInDrawer] = useState(false)

  const isDataSourcesActive = url.startsWith('/data-sources')

  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [drawerOpen])

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false)
  }, [url])

  return (
    <header>
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
            {NAV_LINKS.filter((l) => l.href !== '/').map((link) => (
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
