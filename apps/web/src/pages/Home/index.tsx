import { dataSources } from '@aurboda/api-spec'
import { useEffect } from 'preact/hooks'

import { auth, ensureStatusLoaded, signupAllowed } from '../../state/auth'
import { Dashboard } from '../Dashboard'
import './style.css'

function Screenshot({
  src,
  alt,
  caption,
  className,
}: {
  src: string
  alt: string
  caption: string
  className?: string
}) {
  return (
    <figure class={className}>
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img src={src} alt={alt} />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function GuestHome({ canSignup }: { canSignup: boolean }) {
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
            alt="Timeline with strength training details, heart rate, and location"
            caption="Timeline: activity details, HR, location"
          />
          <Screenshot
            src="/screenshots/timeline-sleep.jpg"
            alt="Timeline showing sleep details with Oura scores"
            caption="Timeline: sleep details and scores"
          />
          <Screenshot
            src="/screenshots/timeline-mobile.jpg"
            alt="Timeline on mobile"
            caption="Mobile timeline"
            className="narrow"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/hr-zones.jpg"
            alt="HR zone minutes breakdown"
            caption="HR zone tracking"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/trends.jpg"
            alt="Trend cards showing metrics over time"
            caption="Trends with EMA smoothing"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/places.jpg"
            alt="Places view with location timeline and map"
            caption="Places and location history"
          />
          <Screenshot
            src="/screenshots/ai-chat.png"
            alt="AI analyzing health data"
            caption="AI health insights via MCP"
          />
        </div>

        <div class="screenshots">
          <Screenshot
            src="/screenshots/app.jpg"
            alt="Aurboda Android app showing HR zone minutes"
            caption="Android app: HR zones"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/app-live.png"
            alt="Live BLE sensor data"
            caption="Live BLE sensors"
            className="narrow"
          />
          <Screenshot
            src="/screenshots/widget.jpg"
            alt="Aurboda home screen widget"
            caption="Home screen widget"
            className="narrow"
          />
        </div>

        <p>
          <a href="https://github.com/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
        </p>
        <p class="note">
          No public signup — self-host your own instance or{' '}
          {canSignup ? (
            <>
              <a href="/signup">sign up</a> if you have an invite.
            </>
          ) : (
            <>
              contact me through{' '}
              <a href="https://www.reddit.com/user/fiddur/" target="_blank" rel="noopener noreferrer">
                reddit
              </a>
              .
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
        <h3>Android</h3>
        <p>
          <a
            href="https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk"
            target="_blank"
            rel="noopener noreferrer"
          >
            Android APK
          </a>
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
        <p>Docker images:</p>
        <ul>
          <li>
            <a
              href="https://github.com/fiddur/aurboda/pkgs/container/aurboda-backend"
              target="_blank"
              rel="noopener noreferrer"
            >
              ghcr.io/fiddur/aurboda-backend
            </a>
          </li>
          <li>
            <a
              href="https://github.com/fiddur/aurboda/pkgs/container/aurboda-web"
              target="_blank"
              rel="noopener noreferrer"
            >
              ghcr.io/fiddur/aurboda-web
            </a>
          </li>
        </ul>
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
  const canSignup = signupAllowed.value

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

      <GuestHome canSignup={canSignup ?? false} />
    </div>
  )
}
