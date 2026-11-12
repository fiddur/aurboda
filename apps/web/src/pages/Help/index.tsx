import { useEffect } from 'preact/hooks'

import { hasAdminContact } from '../../components/admin-contact'
import { AdminContact, useAdminContactLinks } from '../../components/AdminContact'
import '../../components/StaticPage.css'
import { ViewportReadout } from '../../components/ViewportReadout'
import { isEmbedded } from '../../embed'
import { auth, ensureStatusLoaded, signupMode } from '../../state/auth'
import { BUG_REPORT_LINK, DISCUSSION_LINKS, DOCS_LINKS, type HelpLink } from './help-links'

const ExternalLink = ({ link }: { link: HelpLink }) => (
  <a href={link.href} target="_blank" rel="noopener noreferrer">
    {link.label}
  </a>
)

export function Help() {
  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  const isLoggedIn = Boolean(auth.value.token)
  const canSignup = signupMode.value === 'open'
  const hasContact = hasAdminContact(useAdminContactLinks())

  return (
    <div class="static-page">
      <h1>Help &amp; support</h1>
      <p>
        Aurboda is free software looked after by a small community. This page shows where to find answers and
        how to reach the people behind it.
      </p>

      <section>
        <h2>Getting started</h2>
        {isLoggedIn ? (
          <p>
            Your <a href="/">Home page</a> has a <strong>Get started</strong> guide that walks you through the
            first steps: installing the Android app, connecting a watch or ring, tracking time at your
            computer, following a friend or joining a challenge, and asking your data questions.
          </p>
        ) : (
          <p>
            Once you are signed in, your Home page has a <strong>Get started</strong> guide that walks you
            through the first steps: installing the Android app, connecting a watch or ring, tracking time at
            your computer, following a friend or joining a challenge, and asking your data questions.{' '}
            {canSignup ? (
              <>
                <a href="/signup">Create an account</a> or <a href="/login">log in</a> to begin.
              </>
            ) : (
              <>
                <a href="/login">Log in</a> to begin.
              </>
            )}
          </p>
        )}
        <p>
          <a href="/data-sources">Data sources</a> lists everything you can connect, so you can start with
          what you already use. Most people begin with <a href="/data-sources/android-app">the Android app</a>
          , which brings in data from your phone, watch or ring.
        </p>
      </section>

      <section>
        <h2>Read the documentation</h2>
        <p>
          The documentation lives on GitHub and opens in a new tab. You do not need an account to read it.
          These pages are the most useful to start with:
        </p>
        <ul>
          {DOCS_LINKS.map((link) => (
            <li key={link.href}>
              <ExternalLink link={link} />
              {link.description && <>: {link.description}</>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Ask a question or suggest something</h2>
        <p>
          Questions and ideas go in GitHub Discussions, a public forum on GitHub, the site where Aurboda's
          code lives. Anyone can read it. To write, you need a free GitHub account; signing up takes a minute
          and involves no coding.
        </p>
        <ul>
          {DISCUSSION_LINKS.map((link) => (
            <li key={link.href}>
              <ExternalLink link={link} />
            </li>
          ))}
        </ul>
        <p>
          Someone may already have asked the same thing, so browsing first can be the quickest way to an
          answer.
        </p>
      </section>

      <section>
        <h2>Report a bug</h2>
        <p>
          If something is clearly broken, <ExternalLink link={BUG_REPORT_LINK} /> on GitHub. This also needs
          the free GitHub account. If you are not sure whether it is a bug, asking a question as above is fine
          too.
        </p>
        <p>A good report says:</p>
        <ul>
          <li>what you did, what you expected, and what happened instead</li>
          <li>which page or app screen it was (web or the Android app), and roughly when</li>
          <li>a screenshot, if you can take one</li>
        </ul>
        <p>
          If a sync has stopped working, the <a href="/audit-log">audit log</a> (also reachable from Settings)
          often shows the error message; quoting it helps a lot.
        </p>
        <p>
          <strong>Bug reports are public.</strong> Never paste your password, an API token or other people's
          data into one.
        </p>
      </section>

      {hasContact && (
        <section>
          <h2>Contact the server's admin</h2>
          <p>
            For questions about your account, and anything you would rather not ask in public, contact the
            person who runs this server directly.
          </p>
          <AdminContact />
        </section>
      )}

      <section>
        <h2>Your account and data</h2>
        {isLoggedIn && (
          <p>
            In <a href="/settings">Settings</a> you can export all your data, change what you share, and
            delete your account.
          </p>
        )}
        <p>
          Read how your data is handled in the <a href="/privacy">Privacy Policy</a> and the{' '}
          <a href="/terms">Terms of Service</a>.
          {!hasContact && (
            <>
              {' '}
              If you use an Aurboda server that someone else runs, that person is also a good contact for
              questions about your account.
            </>
          )}
        </p>
      </section>

      {isEmbedded() && <ViewportReadout />}
    </div>
  )
}
