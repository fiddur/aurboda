import type { ComponentChildren } from 'preact'

import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { auth, ensureStatusLoaded, logout, signupMode } from '../state/auth'
import {
  HELP_LINK,
  isLinkActive,
  NAV_TOP_LINKS,
  type NavSection,
  pageTitleForPath,
  SETTINGS_LINK,
  visibleLinks,
  visibleSections,
} from './nav-links'
import { NotificationBellLink } from './NotificationBell'
import { useHiddenPages } from './useHiddenPages'
import { useOpenSections } from './useOpenSections'

const DrawerIcon = (props: { children: ComponentChildren }) => (
  <span class="drawer-icon">{props.children}</span>
)

function DrawerSection(props: {
  section: NavSection
  url: string
  open: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const { section, url, open } = props
  const containerId = `drawer-section-${section.id}`
  const holdsActive = section.links.some((l) => isLinkActive(l.href, url))
  return (
    <>
      <button
        class={`drawer-section-toggle${!open && holdsActive ? ' active' : ''}`}
        onClick={props.onToggle}
        type="button"
        aria-expanded={open}
        aria-controls={containerId}
      >
        <DrawerIcon>{section.icon}</DrawerIcon>
        {section.label}
        <span class="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      <div class="drawer-sub-links" id={containerId} hidden={!open}>
        {section.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            class={`drawer-sub-link${isLinkActive(link.href, url) ? ' active' : ''}`}
            onClick={props.onNavigate}
          >
            {link.label}
          </a>
        ))}
      </div>
    </>
  )
}

function DrawerMenu(props: { url: string; onNavigate: () => void }) {
  const { url, onNavigate } = props
  const hidden = useHiddenPages()
  const sections = visibleSections(hidden, !!auth.value.is_admin)
  const { open, toggle } = useOpenSections(url)

  const handleLogout = (e: Event) => {
    e.preventDefault()
    logout()
  }

  return (
    <>
      {visibleLinks(NAV_TOP_LINKS, hidden).map((link) => (
        <a
          key={link.href}
          href={link.href}
          class={isLinkActive(link.href, url) ? 'active' : undefined}
          onClick={onNavigate}
        >
          <DrawerIcon>{link.icon}</DrawerIcon>
          {link.label}
        </a>
      ))}
      {sections.map((section) => (
        <DrawerSection
          key={section.id}
          section={section}
          url={url}
          open={open.includes(section.id)}
          onToggle={() => toggle(section.id)}
          onNavigate={onNavigate}
        />
      ))}
      <div class="drawer-spacer" />
      <a
        href={HELP_LINK.href}
        class={isLinkActive(HELP_LINK.href, url) ? 'active' : undefined}
        onClick={onNavigate}
      >
        <DrawerIcon>{HELP_LINK.icon}</DrawerIcon>
        {HELP_LINK.label}
      </a>
      <a
        href={SETTINGS_LINK.href}
        class={isLinkActive(SETTINGS_LINK.href, url) ? 'active' : undefined}
        onClick={onNavigate}
      >
        <DrawerIcon>{SETTINGS_LINK.icon}</DrawerIcon>
        {SETTINGS_LINK.label}
        <span class="drawer-user">{auth.value.user}</span>
      </a>
      <a href="#" onClick={handleLogout} class="logout-link">
        <DrawerIcon>🚪</DrawerIcon>
        Log out
      </a>
    </>
  )
}

export function Header() {
  const { url } = useLocation()
  const isLoggedIn = auth.value.token
  const canSignup = signupMode.value === 'open'

  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    if (!drawerOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [drawerOpen])

  useEffect(() => {
    setDrawerOpen(false)
  }, [url])

  useEffect(() => {
    if (!isLoggedIn) ensureStatusLoaded()
  }, [isLoggedIn])

  return (
    <header class="app-header">
      <nav class="nav-mobile">
        <button
          class="hamburger-btn"
          onClick={toggleDrawer}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          type="button"
        >
          ☰
        </button>
        <a href="/" class="nav-mobile-brand" aria-label="Aurboda home">
          <img src="/logo.svg" alt="" width={28} height={28} />
        </a>
        <span class="nav-mobile-title">{pageTitleForPath(url)}</span>
        <span class="spacer" />
        {isLoggedIn && <NotificationBellLink />}
        {!isLoggedIn && canSignup && (
          <a href="/signup" class={`nav-mobile-home${url === '/signup' ? ' active' : ''}`}>
            Sign up
          </a>
        )}
      </nav>

      {drawerOpen && <div class="drawer-backdrop" onClick={closeDrawer} />}

      <nav class={`nav-drawer${drawerOpen ? ' open' : ''}`} aria-hidden={!drawerOpen}>
        <div class="drawer-header">
          <span class="drawer-title">Menu</span>
          <button class="drawer-close-btn" onClick={closeDrawer} aria-label="Close menu" type="button">
            ✕
          </button>
        </div>
        {isLoggedIn ? (
          <DrawerMenu url={url} onNavigate={closeDrawer} />
        ) : (
          <>
            <a href="/login" class={url === '/login' ? 'active' : undefined} onClick={closeDrawer}>
              Login
            </a>
            {canSignup && (
              <a href="/signup" class={url === '/signup' ? 'active' : undefined} onClick={closeDrawer}>
                Sign up
              </a>
            )}
            <a
              href={HELP_LINK.href}
              class={url === HELP_LINK.href ? 'active' : undefined}
              onClick={closeDrawer}
            >
              {HELP_LINK.label}
            </a>
          </>
        )}
      </nav>
    </header>
  )
}
