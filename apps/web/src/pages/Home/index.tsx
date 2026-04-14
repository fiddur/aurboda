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
          Your health, fitness, productivity, and location data is scattered across apps and services. Aurboda
          aggregates it all into one self-hosted platform, provides rich visualizations, and exposes
          everything to AI assistants via{' '}
          <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer">
            MCP (Model Context Protocol)
          </a>
          .
        </p>

        <h3>What it does</h3>
        <ul>
          <li>
            <strong>Aggregates</strong> health data from Android Health Connect, Oura, Garmin, OwnTracks,
            RescueTime, ActivityWatch, Last.fm, calendar feeds, and more.
          </li>
          <li>
            <strong>Visualizes</strong> timelines, heart rate zones, sleep patterns, trends, correlations,
            location history, training load, and screen time.
          </li>
          <li>
            <strong>AI-ready</strong> via MCP — connect Claude or other AI assistants to your self-hosted
            instance to query your health data and find insights.
          </li>
        </ul>

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
            <tr>
              <td>
                <strong>Android Health Connect</strong>
              </td>
              <td>Heart rate, HRV, sleep, exercise (80+ types), steps, weight, SpO2, VO2 max, calories</td>
              <td>Push from Android app</td>
            </tr>
            <tr>
              <td>
                <strong>BLE Sensors</strong>
              </td>
              <td>Real-time heart rate, HRV (Polar H10, etc.) and steps (Zwift RunPod, etc.)</td>
              <td>Live via Android app</td>
            </tr>
            <tr>
              <td>
                <a href="https://ouraring.com/" target="_blank" rel="noopener noreferrer">
                  <strong>Oura Ring</strong>
                </a>
              </td>
              <td>Sleep stages/scores, readiness, resilience, cardiovascular age, HRV, heart rate, tags</td>
              <td>Pull (API) + Push (webhooks)</td>
            </tr>
            <tr>
              <td>
                <a href="https://connect.garmin.com/" target="_blank" rel="noopener noreferrer">
                  <strong>Garmin Connect</strong>
                </a>
              </td>
              <td>Daily summary, HR, HRV, sleep, stress, body battery, activities, SpO2, respiration</td>
              <td>Pull (session-based)</td>
            </tr>
            <tr>
              <td>
                <a href="https://owntracks.org/" target="_blank" rel="noopener noreferrer">
                  <strong>OwnTracks</strong>
                </a>
              </td>
              <td>GPS locations, geofences, place visits</td>
              <td>Push (HTTP mode)</td>
            </tr>
            <tr>
              <td>
                <a href="https://www.rescuetime.com/" target="_blank" rel="noopener noreferrer">
                  <strong>RescueTime</strong>
                </a>
              </td>
              <td>App/website usage, productivity scores, categories</td>
              <td>Pull (API)</td>
            </tr>
            <tr>
              <td>
                <a href="https://activitywatch.net/" target="_blank" rel="noopener noreferrer">
                  <strong>ActivityWatch</strong>
                </a>
              </td>
              <td>App/window usage per device (desktop and Android)</td>
              <td>Push (agent script)</td>
            </tr>
            <tr>
              <td>
                <a href="https://www.last.fm/" target="_blank" rel="noopener noreferrer">
                  <strong>Last.fm</strong>
                </a>
              </td>
              <td>Music scrobbles with auto-generated activities from configurable rules</td>
              <td>Pull (API)</td>
            </tr>
            <tr>
              <td>
                <strong>Calendars (ICS)</strong>
              </td>
              <td>
                Calendar events imported as activities (Google Calendar, Outlook, iCloud, Nextcloud, etc.)
              </td>
              <td>Pull (ICS fetch)</td>
            </tr>
            <tr>
              <td>
                <a href="https://cronometer.com/" target="_blank" rel="noopener noreferrer">
                  <strong>Cronometer</strong>
                </a>
              </td>
              <td>Meals with full per-item macros and ~50 micronutrients</td>
              <td>CSV import script</td>
            </tr>
            <tr>
              <td>
                <strong>Manual Entry</strong>
              </td>
              <td>Any metric, activity, meal, or note</td>
              <td>Web UI, REST API, or MCP</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="features">
        <h2>Features</h2>
        <ul>
          <li>
            <strong>Timeline</strong> — Multi-track interactive day view: activities, metrics, screen time,
            music, and location
          </li>
          <li>
            <strong>Dashboard</strong> — Customizable widget-based home page with metric cards, sparklines,
            trends, and correlations
          </li>
          <li>
            <strong>HR Zones</strong> — Weekly heart rate zone tracking with Huberman/Galpin protocol targets
          </li>
          <li>
            <strong>Correlation Analysis</strong> — Pearson coefficients, chi-squared tests, relative risk,
            activity impact timelines
          </li>
          <li>
            <strong>Trends (EMA)</strong> — Exponential Moving Average smoothing for activity types, metrics,
            and screen time
          </li>
          <li>
            <strong>Goals</strong> — Rolling-window health targets
          </li>
          <li>
            <strong>Sleep Analysis</strong> — Sleep quality tracking, hypnogram, Oura scores
          </li>
          <li>
            <strong>Training Load</strong> — Banister model fitness/fatigue tracking (CTL/ATL/TSB)
          </li>
          <li>
            <strong>Places</strong> — GPS location history, auto-detected locations, visit tracking with
            PostGIS
          </li>
          <li>
            <strong>Meals & Nutrition</strong> — Quick sensitivity logging, Cronometer/Oura import, per-item
            micronutrients
          </li>
          <li>
            <strong>Lab Reports</strong> — Structured lab results with metric write-through and reference
            ranges
          </li>
          <li>
            <strong>MCP Integration</strong> — Full AI assistant access via Model Context Protocol (50+ tools)
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
