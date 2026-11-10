import { dataSources } from '@aurboda/api-spec'
import { Fragment } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

import { Footer } from '../../components/Footer'
import { guestSignup, type GuestSignup, heroBillingLine } from '../../components/guest-signup'
import { ImageViewerLink } from '../../components/ImageViewer'
import { PublicTagLinks } from '../../components/PublicTagLinks'
import { auth, ensureStatusLoaded, serverBilling, signupMode } from '../../state/auth'
import { docsUrl } from '../../utils/docs-url'
import { Dashboard } from '../Dashboard'
import './style.css'

const SHOTS = '/screenshots/welcome'
const PHONE = '(max-width: 640px)'
const DARK = '(prefers-color-scheme: dark)'
const GITHUB = 'https://github.com/fiddur/aurboda'
const DISCUSSIONS = `${GITHUB}/discussions`
const APK_URL = 'https://github.com/fiddur/aurboda/releases/latest/download/aurboda.apk'

interface ShotFile {
  name: string
  width: number
  height: number
}

const DASHBOARD: ShotFile = { height: 992, name: 'dashboard', width: 1600 }
const TIMELINE_DAY: ShotFile = { height: 1101, name: 'timeline-day', width: 1600 }
const CORRELATIONS: ShotFile = { height: 858, name: 'correlations', width: 1600 }
const CHALLENGE: ShotFile = { height: 1107, name: 'challenge', width: 1600 }
const FEED_POST: ShotFile = { height: 789, name: 'feed-post', width: 1000 }
const PLACES: ShotFile = { height: 1047, name: 'places', width: 1600 }
const TIMELINE_MOBILE: ShotFile = { height: 895, name: 'timeline-mobile', width: 600 }

const shotUrl = (name: string, theme: 'light' | 'dark') => `${SHOTS}/${name}-${theme}.webp`

const prefersDark = (): boolean => {
  try {
    return window.matchMedia(DARK).matches
  } catch {
    return false
  }
}

/** A light/dark screenshot that opens the full image in a viewer; `phone` swaps in another shot on narrow screens. */
function Shot({
  shot,
  alt,
  className,
  eager = false,
  phone,
}: {
  shot: ShotFile
  alt: string
  className?: string
  eager?: boolean
  phone?: ShotFile
}) {
  return (
    <ImageViewerLink
      href={shotUrl(shot.name, prefersDark() ? 'dark' : 'light')}
      caption={alt}
      className={`welcome-shot${className ? ` ${className}` : ''}`}
    >
      <picture>
        {phone && (
          <source
            media={`${PHONE} and ${DARK}`}
            srcset={shotUrl(phone.name, 'dark')}
            width={phone.width}
            height={phone.height}
          />
        )}
        {phone && (
          <source
            media={PHONE}
            srcset={shotUrl(phone.name, 'light')}
            width={phone.width}
            height={phone.height}
          />
        )}
        <source media={DARK} srcset={shotUrl(shot.name, 'dark')} width={shot.width} height={shot.height} />
        <img
          src={shotUrl(shot.name, 'light')}
          alt={alt}
          width={shot.width}
          height={shot.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      </picture>
    </ImageViewerLink>
  )
}

interface DocLink {
  href: string
  label: string
}

/** Quiet links from a section to the documentation that explains it further, opening in a new tab. */
function ReadMore({ links }: { links: DocLink[] }) {
  return (
    <p class="welcome-read-more">
      {links.map((link, i) => (
        <Fragment key={link.href}>
          {i > 0 && ' · '}
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </Fragment>
      ))}
    </p>
  )
}

const SOURCE_CHIPS = [
  'Garmin',
  'Oura',
  'Strava',
  'Android Health Connect',
  'ActivityWatch',
  'Last.fm',
  'Calendars',
  'OwnTracks',
  'RescueTime',
]

const LOG_CHIPS = [
  'Coffee after 3 pm',
  'Painkiller',
  'Headache',
  'Alcohol',
  'Sauna',
  'Meditation',
  'Sex',
  'Period',
]

function HeroSignup({ signup }: { signup: GuestSignup }) {
  const howItWorks = (
    <a href="#how" class="welcome-button welcome-button-outline">
      How it works
    </a>
  )

  if (signup.mode === 'open') {
    const billing = heroBillingLine(signup.billingLine)
    return (
      <>
        <div class="welcome-cta-row">
          <a href="/signup" class="welcome-button welcome-button-cta">
            Start free
          </a>
          {howItWorks}
        </div>
        {billing && <p class="welcome-hero-note">{billing}</p>}
        {billing ? (
          <p class="welcome-hero-state welcome-hero-own">
            No lock-in: Aurboda is open source, so during the trial or after it you can export everything and
            import it into <a href="#own">your own server</a>.
          </p>
        ) : (
          <p class="welcome-hero-state welcome-hero-own">
            Prefer your own server? Aurboda is open source: <a href="#own">run your own</a>, and move your
            data there whenever you like.
          </p>
        )}
      </>
    )
  }

  return (
    <>
      {signup.mode === 'invite_only' && (
        <p class="welcome-hero-state">
          Joining this server needs an invitation link from someone who is already on it. You can also{' '}
          <a href="#own">run your own</a>.
        </p>
      )}
      {signup.mode === 'closed' && (
        <p class="welcome-hero-state">
          This server is not taking new accounts. You can <a href="#own">run your own</a>.
        </p>
      )}
      <div class="welcome-cta-row">{howItWorks}</div>
    </>
  )
}

function DataSourcesTable() {
  return (
    <table class="welcome-sources-table">
      <thead>
        <tr>
          <th>Source</th>
          <th>What it provides</th>
          <th>How</th>
        </tr>
      </thead>
      <tbody>
        {dataSources.map((source) => (
          <tr key={source.name}>
            <td>
              {source.homepage ? (
                <a href={source.homepage} target="_blank" rel="noopener noreferrer">
                  <strong>{source.name}</strong>
                </a>
              ) : (
                <strong>{source.name}</strong>
              )}
            </td>
            <td>{source.provides}</td>
            <td>{source.how}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Welcome({ signup }: { signup: GuestSignup }) {
  const sourcesRef = useRef<HTMLDetailsElement>(null)

  // A link from another page (the guest bar's "Run your own" → /#own) lands here by client-side routing,
  // which does not scroll to the fragment by itself.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  const openSources = () => {
    if (sourcesRef.current) sourcesRef.current.open = true
  }

  return (
    <div class="welcome">
      <section class="welcome-hero">
        <div class="welcome-wrap welcome-hero-inner">
          <div class="welcome-hero-text">
            <p class="welcome-eyebrow">Health, training and habits in one place</p>
            <h1>See how your sleep, training and everyday life fit together.</h1>
            <p class="welcome-lead">
              Aurboda collects what your watch, ring, phone and apps already know about you, puts it on one
              timeline, and shows what actually makes a difference. Share workouts and challenges with friends
              along the way.
            </p>
            <HeroSignup signup={signup} />
          </div>
          <div class="welcome-hero-shot">
            <Shot
              shot={DASHBOARD}
              phone={TIMELINE_MOBILE}
              eager
              alt="A dashboard with HRV and resting heart rate baselines, last night's sleep stages, sleep and readiness scores and daily steps"
            />
          </div>
        </div>
      </section>

      <section class="welcome-wrap welcome-works-with" aria-label="Works with">
        <p class="welcome-works-with-title">Works with the things you already use</p>
        <div class="welcome-chips">
          {SOURCE_CHIPS.map((name) => (
            <span key={name} class="welcome-chip">
              {name}
            </span>
          ))}
          <a href="#sources" class="welcome-chip-link" onClick={openSources}>
            All sources
          </a>
        </div>
      </section>

      <section id="how" class="welcome-wrap welcome-section welcome-stack">
        <h2>Your whole day on one timeline</h2>
        <p class="welcome-body welcome-measure">
          Sleep, workouts with heart rate, where you were, what you ate, what you listened to and how long you
          sat at the computer. Tap anything to see the details.
        </p>
        <Shot
          shot={TIMELINE_DAY}
          className="welcome-shot-framed"
          alt="The timeline for one day: sleep, coffee, meals and an evening run above the heart rate curve, with home and work below"
        />
        <ReadMore
          links={[{ href: docsUrl('features/timeline.md'), label: 'Read more about the timeline' }]}
        />
      </section>

      <section id="log" class="welcome-wrap welcome-section">
        <div class="welcome-card welcome-log">
          <div class="welcome-log-text">
            <h2>Log what no tracker sees</h2>
            <p class="welcome-body">
              Your watch knows your pulse, but not that you took a painkiller, had coffee at four, or had sex
              last night. What you log is up to you: make your own list and log anything with one tap.
            </p>
            <p class="welcome-muted">
              Private unless you choose to share it. Everything you log can be compared with your sleep, heart
              rate and training.
            </p>
            <ReadMore
              links={[
                {
                  href: docsUrl('features/activity-types.md'),
                  label: 'Read more about your own activity types',
                },
              ]}
            />
          </div>
          <div class="welcome-chips">
            {LOG_CHIPS.map((name) => (
              <span key={name} class="welcome-chip welcome-chip-soft">
                {name}
              </span>
            ))}
            <span class="welcome-chip welcome-chip-dashed">+ your own</span>
          </div>
        </div>
      </section>

      <section class="welcome-wrap welcome-section welcome-split">
        <div class="welcome-split-text">
          <h2>Find out what actually helps</h2>
          <p class="welcome-body">
            Does the evening run improve your sleep? Is coffee after three costing you recovery? Aurboda
            compares the days with and without it, tells you how big the difference is, and whether it is more
            than chance.
          </p>
          <p class="welcome-body">
            You can also ask in plain language: connect Claude or another AI assistant and it can read your
            data and answer.
          </p>
          <ReadMore
            links={[{ href: docsUrl('features/correlations.md'), label: 'Read more about correlations' }]}
          />
        </div>
        <Shot
          shot={CORRELATIONS}
          className="welcome-split-shot welcome-shot-framed"
          alt="Sleep score on the night after alcohol compared with nights without: 66 with, 83 without, a large difference"
        />
      </section>

      <section id="together" class="welcome-band">
        <div class="welcome-wrap welcome-split">
          <Shot
            shot={CHALLENGE}
            className="welcome-split-shot"
            alt="A step challenge between seven friends with a race chart and a leaderboard"
          />
          <div class="welcome-split-text">
            <p class="welcome-eyebrow">Train together</p>
            <h2>Share workouts, start a challenge, give kudos</h2>
            <ul class="welcome-body">
              <li>Post a run, ride or gym session with just the numbers you want to show</li>
              <li>Step, distance and time challenges with a live race chart</li>
              <li>Kudos and comments from friends</li>
              <li>Follow people on any Aurboda server, or from Mastodon</li>
            </ul>
            <p class="welcome-body-small">
              Like the training apps you know, without the ads and without selling your data.
            </p>
            <PublicTagLinks class="welcome-body-small" />
            <ReadMore
              links={[
                { href: docsUrl('features/challenges.md'), label: 'Read more about challenges' },
                { href: docsUrl('features/feed.md'), label: 'the feed' },
              ]}
            />
          </div>
        </div>
      </section>

      <section class="welcome-wrap welcome-figures">
        <figure>
          <Shot
            shot={FEED_POST}
            className="welcome-figure-shot"
            alt="A shared evening run with distance, heart rate, heart rate zones and the heart rate curve"
          />
          <figcaption>
            <strong>Share a workout.</strong> Your run with its heart rate, the way friends see it in their
            feed.
          </figcaption>
        </figure>
        <figure>
          <Shot
            shot={PLACES}
            className="welcome-figure-shot"
            alt="The places of one day, with time spent at each, next to a map"
          />
          <figcaption>
            <strong>Places.</strong> Where you spend your time, and how it shows in your sleep and mood.
          </figcaption>
        </figure>
        <figure>
          <Shot
            shot={TIMELINE_MOBILE}
            className="welcome-figure-shot welcome-figure-phone"
            alt="The timeline on a phone"
          />
          <figcaption>
            <strong>On your phone.</strong> The Android app syncs Health Connect and live heart rate.
          </figcaption>
        </figure>
      </section>

      <section id="android" class="welcome-wrap welcome-section">
        <div class="welcome-card welcome-app">
          <div class="welcome-app-text">
            <h2>Get the Android app</h2>
            <p class="welcome-body-small">
              Syncs Health Connect in the background and shows live heart rate from Bluetooth sensors.
            </p>
            <p class="welcome-muted-small">
              Not in Google Play or F-Droid yet: open the downloaded file on your phone and allow installing
              from your browser. The app updates itself after that.
            </p>
          </div>
          <a
            href={APK_URL}
            class="welcome-button welcome-button-primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the Android app (APK)
          </a>
        </div>
      </section>

      <section id="own" class="welcome-wrap welcome-section welcome-stack">
        <h2>Your data, your rules</h2>
        <div class="welcome-cards">
          <div class="welcome-card">
            <h3>Nothing is shared unless you share it</h3>
            <p>Every post, dashboard and challenge entry is opt-in, and you pick the fields.</p>
            <ReadMore links={[{ href: docsUrl('features/sharing.md'), label: 'Read more about sharing' }]} />
          </div>
          <div class="welcome-card">
            <h3>Take it all with you</h3>
            <p>
              Export everything in one file and restore it on your own server, or delete your account and
              every row with it.
            </p>
            <ReadMore links={[{ href: docsUrl('data-export.md'), label: 'Read more about export' }]} />
          </div>
          <div class="welcome-card">
            <h3>Open source</h3>
            <p>
              Free software (AGPL). Run your own server with Docker if you prefer; it still talks to everyone
              else's.
            </p>
            <ReadMore
              links={[
                { href: docsUrl('docker.md'), label: 'Running your own' },
                { href: GITHUB, label: 'Source code' },
              ]}
            />
          </div>
          <div class="welcome-card">
            <h3>For tinkerers</h3>
            <p>
              A full REST API, an MCP server for AI assistants, and rules that turn raw data into activities.
            </p>
            <ReadMore
              links={[
                { href: docsUrl('mcp-server.md'), label: 'MCP server' },
                { href: '/apispec/', label: 'REST API' },
              ]}
            />
          </div>
        </div>
        <p class="welcome-selfhost">
          <strong>Self-hosting.</strong> Run your own server with Docker Compose, starting from the{' '}
          <a href={`${GITHUB}/blob/develop/docker-compose.yml`} target="_blank" rel="noopener noreferrer">
            docker-compose.yml example
          </a>
          . The image is{' '}
          <a href="https://hub.docker.com/r/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            fiddur/aurboda
          </a>{' '}
          on Docker Hub: <code>:latest</code> is the released version (from <code>main</code>),{' '}
          <code>:develop</code> the beta (every merged PR). The code is on{' '}
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </section>

      <section class="welcome-wrap welcome-section welcome-sources-section">
        <details id="sources" ref={sourcesRef} class="welcome-sources">
          <summary>All data sources</summary>
          <DataSourcesTable />
          <div class="welcome-sources-more">
            <ReadMore
              links={[
                { href: docsUrl('data-sources.md'), label: 'Read more about each source and how it syncs' },
              ]}
            />
          </div>
        </details>
      </section>

      {signup.mode === 'open' && (
        <section class="welcome-closing">
          <div class="welcome-wrap welcome-closing-inner">
            <div class="welcome-closing-text">
              <h2>Start with what you already track</h2>
              <p>
                Connect one source and the timeline fills in by itself.
                {signup.billingLine && ` ${signup.billingLine}`}
              </p>
            </div>
            <a href="/signup" class="welcome-button welcome-button-cta">
              Create your account
            </a>
          </div>
        </section>
      )}

      <section class="welcome-wrap welcome-outro">
        <p class="welcome-body-small">
          Have a question or an idea?{' '}
          <a href={DISCUSSIONS} target="_blank" rel="noopener noreferrer">
            Ask in GitHub Discussions
          </a>
          , or see <a href="/help">Help &amp; support</a>.
        </p>
      </section>

      <div class="welcome-wrap welcome-footer">
        <Footer tagline="Aurboda: in Norse myth, the giantess who gathers and provides." />
      </div>
    </div>
  )
}

export function Home() {
  const isLoggedIn = auth.value.token

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  if (isLoggedIn) {
    return <Dashboard />
  }

  return <Welcome signup={guestSignup(signupMode.value, serverBilling.value)} />
}
