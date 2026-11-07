import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { officialFeedPath } from '../state/api/blogUrls'
import { ensureStatusLoaded, officialFeedEnabled, serverBilling, signupMode } from '../state/auth'
import './GuestBar.css'
import { guestBarSignupLabel, guestSignup } from './guest-signup'

const SECTION_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#together', label: 'Train together' },
  { href: '#own', label: 'Your data, your rules' },
]

function SignupActions({ page, loginHref }: { page: 'welcome' | 'public'; loginHref: string }) {
  const signup = guestSignup(signupMode.value, serverBilling.value)
  const login = (
    <a href={loginHref} class="guest-bar-link">
      Log in
    </a>
  )

  switch (signup.mode) {
    case 'open':
      return (
        <>
          {login}
          <a href="/signup" class="guest-bar-cta">
            <span class="guest-bar-cta-long">{guestBarSignupLabel(signup.trialDays, page)}</span>
            <span class="guest-bar-cta-short">Sign up</span>
          </a>
        </>
      )
    case 'invite_only':
      return (
        <>
          <span class="guest-bar-note">Joining needs an invitation link</span>
          {login}
        </>
      )
    case 'closed':
      return (
        <>
          <a href={page === 'welcome' ? '#own' : '/#own'} class="guest-bar-link guest-bar-link-soft">
            Run your own
          </a>
          {login}
        </>
      )
    case 'unknown':
      return login
  }
}

/**
 * The top bar for a logged-out visitor on the welcome page or a public page, in place of the
 * app navigation. The welcome page gets section links (behind a menu button on narrow
 * screens); other pages a short tagline. The right side follows the server's signup mode.
 */
export function GuestBar() {
  const { path, url } = useLocation()
  const page = path === '/' ? 'welcome' : 'public'
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [url])

  useEffect(() => {
    if (!menuOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [menuOpen])

  const sectionLinks = officialFeedEnabled.value
    ? [...SECTION_LINKS, { href: officialFeedPath, label: 'Blog' }]
    : SECTION_LINKS
  const loginHref = page === 'welcome' ? '/login' : `/login?next=${encodeURIComponent(url)}`

  return (
    <header class="guest-bar">
      <div class="guest-bar-inner">
        {page === 'welcome' && (
          <button
            type="button"
            class="guest-bar-menu"
            aria-label={menuOpen ? 'Close section menu' : 'Open section menu'}
            aria-expanded={menuOpen}
            aria-controls="guest-bar-sections"
            onClick={() => setMenuOpen((open) => !open)}
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
              <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
        )}
        <a href="/" class="guest-bar-brand">
          <img src="/logo.svg" alt="" width={36} height={36} />
          Aurboda
        </a>
        {page === 'welcome' ? (
          <nav
            id="guest-bar-sections"
            class={`guest-bar-sections${menuOpen ? ' open' : ''}`}
            aria-label="Sections"
          >
            {sectionLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
          </nav>
        ) : (
          <span class="guest-bar-tagline">Track your health and train with friends</span>
        )}
        <div class="guest-bar-actions">
          <SignupActions page={page} loginHref={loginHref} />
        </div>
      </div>
    </header>
  )
}
