import { dataSources } from '@aurboda/api-spec'
import { useEffect } from 'preact/hooks'

import { blogPath } from '../../state/api/blogUrls'
import {
  auth,
  blogUsername,
  ensureStatusLoaded,
  serverBilling,
  type SignupMode,
  signupMode,
} from '../../state/auth'
import { signupBillingLine } from '../../utils/plan'
import { Dashboard } from '../Dashboard'
import './style.css'

/** Every screenshot has a `.webp` sibling in `public/screenshots/`; the original is the fallback. */
function Screenshot({
  src,
  alt,
  caption,
  className,
  width,
  height,
  eager = false,
}: {
  src: string
  alt: string
  caption: string
  className?: string
  width: number
  height: number
  eager?: boolean
}) {
  return (
    <figure class={className}>
      <a href={src} target="_blank" rel="noopener noreferrer">
        <picture>
          <source type="image/webp" srcset={src.replace(/\.(jpg|png)$/, '.webp')} />
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
        </picture>
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

const contactLink = (
  <a href="https://www.reddit.com/user/fiddur/" target="_blank" rel="noopener noreferrer">
    reddit
  </a>
)

function SignupCallout({ mode }: { mode: SignupMode | undefined }) {
  if (mode === undefined) return null
  if (mode === 'open') {
    const billing = signupBillingLine(serverBilling.value)
    return (
      <p class="signup-callout">
        <a href="/signup" class="signup-callout-button">
          Create an account
        </a>
        <span>
          {billing ?? 'Open for new accounts.'} Already have one? <a href="/login">Log in</a>.
        </span>
      </p>
    )
  }
  return (
    <p class="signup-callout">
      <span>
        {mode === 'invite_only'
          ? 'Signing up on this server needs an invitation link'
          : 'This server is not taking new accounts'}{' '}
        — ask for one through {contactLink}, or self-host your own instance (see below). Already have an
        account? <a href="/login">Log in</a>.
      </span>
    </p>
  )
}

function GuestHome({ blogUser }: { blogUser: string | null }) {
  return (
    <>
      <section class="intro">
        <p>
          <strong>A self-hosted personal data warehouse for quantified self.</strong> Aurboda unifies your
          health, fitness, productivity, location, and nutrition data — from Oura, Garmin, Strava, Android
          Health Connect, screen-time trackers, calendars, and more — into a single timeline and database that
          lives on your own server.
        </p>
        <p>
          Think of it as{' '}
          <strong>Home Assistant, but for your personal data instead of your smart home.</strong> Once
          everything is in one place, you can explore it visually, analyze it for trends and correlations, and
          query your whole life in plain language by connecting Claude or any{' '}
          <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer">
            MCP
          </a>{' '}
          client.
        </p>
        <p>
          Instead of “my data is scattered across ten apps,” you can finally ask{' '}
          <em>“is there a link between my coffee, HRV, sleep, and headaches?”</em> — and get an answer.
        </p>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/timeline-detail.jpg"
            width={1899}
            height={867}
            eager
            alt="Timeline with strength training details, heart rate, and location"
            caption="Timeline: activity details, HR, location"
          />
          <Screenshot
            src="/screenshots/timeline-sleep.jpg"
            width={1861}
            height={653}
            eager
            alt="Timeline showing sleep details with Oura scores"
            caption="Timeline: sleep details and scores"
          />
          <Screenshot
            src="/screenshots/timeline-mobile.jpg"
            width={1080}
            height={2404}
            eager
            alt="Timeline on mobile"
            caption="Mobile timeline"
            className="narrow"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/hr-zones.jpg"
            width={1080}
            height={1338}
            alt="HR zone minutes breakdown"
            caption="HR zone tracking"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/trends.jpg"
            width={1850}
            height={489}
            alt="Trend cards showing metrics over time"
            caption="Trends with EMA smoothing"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/places.jpg"
            width={1919}
            height={778}
            alt="Places view with location timeline and map"
            caption="Places and location history"
          />
          <Screenshot
            src="/screenshots/ai-chat.png"
            width={1080}
            height={1697}
            alt="AI analyzing health data"
            caption="AI health insights via MCP"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/app.jpg"
            width={1080}
            height={1338}
            alt="Aurboda Android app showing HR zone minutes"
            caption="Android app: HR zones"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/app-live.png"
            width={1080}
            height={761}
            alt="Live BLE sensor data"
            caption="Live BLE sensors"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/widget.jpg"
            width={532}
            height={325}
            alt="Aurboda home screen widget"
            caption="Home screen widget"
            className="narrow"
          />
        </div>

        <p>
          <a href="https://github.com/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
          {blogUser && (
            <>
              {' · '}
              <a href={blogPath(blogUser)}>Read the blog</a>
            </>
          )}
        </p>
      </section>

      <section class="features">
        <h2>Data Sources</h2>
        <table class="data-sources-table">
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
      </section>

      <section class="features">
        <h2>What you can do</h2>
        <p>Everything above feeds a common data model, so every feature works across every source:</p>
        <ul>
          <li>
            <strong>Explore</strong> — a unified timeline, customizable dashboards, and maps of where you've
            been
          </li>
          <li>
            <strong>Analyze</strong> — trends with EMA smoothing, correlations (Pearson, chi-squared, relative
            risk), and rolling-window goals
          </li>
          <li>
            <strong>Track health</strong> — sleep, HR zones (Huberman/Galpin targets), training load (Banister
            model), lab results, and active-calorie computation
          </li>
          <li>
            <strong>Organize life</strong> — activities, meals &amp; nutrition, places, and screen time
          </li>
          <li>
            <strong>Automate</strong> — deduction rules that create activities from your data, plus custom
            activity types
          </li>
          <li>
            <strong>Share</strong> — read-only public dashboards and federated challenges across Aurboda
            instances
          </li>
          <li>
            <strong>AI access</strong> — full query access from Claude or any MCP client (60+ tools)
          </li>
        </ul>
      </section>

      <section class="downloads">
        <h2>Downloads &amp; Deployment</h2>
        <h3>Android app</h3>
        <p>
          <a
            href="https://github.com/fiddur/aurboda/releases/latest/download/aurboda.apk"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the Aurboda Android app (APK)
          </a>
        </p>
        <p class="note">
          Not in Google Play or F-Droid yet: open the downloaded file on your phone and allow installing from
          your browser. The app updates itself after that.
        </p>
        <h3>Self-hosting with Docker</h3>
        <p>
          Run your own Aurboda instance using Docker Compose. See the{' '}
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docker-compose.yml"
            target="_blank"
            rel="noopener noreferrer"
          >
            docker-compose.yml example
          </a>{' '}
          on GitHub.
        </p>
        <p>
          Docker image:{' '}
          <a href="https://hub.docker.com/r/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            fiddur/aurboda
          </a>{' '}
          on Docker Hub — <code>:latest</code> is the released version (from <code>main</code>),{' '}
          <code>:develop</code> is the beta (every merged PR).
        </p>
      </section>

      <section class="name">
        <h2>About the Name</h2>
        <p>
          In Norse mythology, Aurbo&eth;a (really pronounced "owr-BO-tha", but using a hard D in aurboda now)
          is a mountain j&ouml;tunn (giantess) associated with strength and vitality. Her name, meaning
          "gravel-offerer" or "gold-offerer", reflects her role as a gatherer and provider. As mother of
          Ger&eth;r, whose name relates to growth and gardens, Aurbo&eth;a represents the foundation from
          which health and flourishing emerge.
        </p>
        <p>
          This project embodies that spirit: gathering scattered health data from multiple sources into a
          unified foundation for understanding your wellbeing.
        </p>
      </section>

      <section class="legal">
        <p>
          <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
        </p>
      </section>
    </>
  )
}

export function Home() {
  const isLoggedIn = auth.value.token

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  // When logged in, show Dashboard without the .home wrapper (which has max-width: 800px)
  if (isLoggedIn) {
    return <Dashboard />
  }

  return (
    <div class="home">
      <div class="hero">
        <img src="/logo.svg" alt="Aurboda logo" class="hero-logo" />
        <div class="hero-text">
          <h1>Aurboda</h1>
          <p class="subtitle">Self Quantification Aggregator</p>
        </div>
      </div>

      <SignupCallout mode={signupMode.value} />

      <GuestHome blogUser={blogUsername.value} />
    </div>
  )
}
