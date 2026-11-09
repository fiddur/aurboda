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

const GITHUB_URL = 'https://github.com/fiddur/aurboda'

function GitHubLink() {
  return (
    <a
      href={GITHUB_URL}
      class="guest-bar-icon"
      aria-label="Aurboda on GitHub"
      title="Aurboda on GitHub"
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </a>
  )
}

/** Where the visitor is: the welcome page, the login or signup page (which link to each other, not to themselves), or a public page. */
type GuestPage = 'welcome' | 'login' | 'signup' | 'public'

function SignupActions({ page, loginHref }: { page: GuestPage; loginHref: string }) {
  const signup = guestSignup(signupMode.value, serverBilling.value)
  const login = (
    <>
      <GitHubLink />
      {page !== 'login' && (
        <a href={loginHref} class="guest-bar-link">
          Log in
        </a>
      )}
    </>
  )

  switch (signup.mode) {
    case 'open':
      return (
        <>
          {login}
          {page !== 'signup' && (
            <a href="/signup" class="guest-bar-cta">
              <span class="guest-bar-cta-long">
                {guestBarSignupLabel(signup.trialDays, page === 'welcome' ? 'welcome' : 'public')}
              </span>
              <span class="guest-bar-cta-short">Sign up</span>
            </a>
          )}
        </>
      )
    case 'invite_only':
      return (
        <>
          {page !== 'signup' && <span class="guest-bar-note">Joining needs an invitation link</span>}
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

const guestPage = (path: string): GuestPage => {
  if (path === '/') return 'welcome'
  if (path === '/login') return 'login'
  if (path === '/signup') return 'signup'
  return 'public'
}

/**
 * The top bar for a logged-out visitor on the welcome page, login, signup or a public page, in place of the
 * app navigation. The welcome page gets section links (behind a menu button on narrow
 * screens); other pages a short tagline. The right side follows the server's signup mode.
 */
export function GuestBar() {
  const { path, url } = useLocation()
  const page = guestPage(path)
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
  const loginHref = page === 'public' ? `/login?next=${encodeURIComponent(url)}` : '/login'

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
