import { useEffect } from 'preact/hooks'
import { auth, ensureStatusLoaded, signupAllowed } from '../../state/auth'

import './style.css'

function GuestHome({ canSignup }: { canSignup: boolean }) {
  return (
    <>
      <section class="intro">
        <p>
          Your health data is scattered across apps and services. Aurboda brings it all together, letting you
          visualize trends and discuss your health with AI assistants.
        </p>

        <h3>What it does</h3>
        <ul>
          <li>
            <strong>Aggregates</strong> health data from Android Health Connect, Oura, OwnTracks, and
            RescueTime into one place.
          </li>
          <li>
            <strong>Visualizes</strong> your heart rate zones, sleep patterns, location history, and exercise
            data.
          </li>
          <li>
            <strong>AI-ready</strong> via MCP (Model Context Protocol) — optionally connect Claude or other AI
            assistants to your self-hosted instance to ask questions about your health data.
          </li>
        </ul>

        <div class="screenshots">
          <figure>
            <img src="/screenshots/app.jpg" alt="Aurboda Android app showing HR zone minutes" />
            <figcaption>Android app: HR zone tracking</figcaption>
          </figure>
          <figure>
            <img src="/screenshots/widget.jpg" alt="Aurboda home screen widget" />
            <figcaption>Home screen widget</figcaption>
          </figure>
        </div>

        <p>
          <a href="https://github.com/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
        </p>
        <p class="note">
          Currently in early development.{' '}
          {canSignup ?
            <>
              <a href="/signup">Sign up</a> to get started, or self-host your own instance.
            </>
          : <>
              Signup is not available on this server. You can self-host or contact me through{' '}
              <a href="https://www.reddit.com/user/fiddur/" target="_blank" rel="noopener noreferrer">
                reddit
              </a>
              .
            </>
          }
        </p>
      </section>

      <section class="features">
        <h2>Data Sources</h2>
        <ul>
          <li>
            Android Health Connect from{' '}
            <a href="https://github.com/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
              Aurboda App
            </a>
          </li>
          <li>
            <a href="https://owntracks.org/" target="_blank" rel="noopener noreferrer">
              OwnTracks
            </a>{' '}
            (json http mode)
          </li>
          <li>
            <a href="https://ouraring.com/" target="_blank" rel="noopener noreferrer">
              Oura
            </a>{' '}
            API
          </li>
          <li>
            <a href="https://www.rescuetime.com/" target="_blank" rel="noopener noreferrer">
              RescueTime
            </a>{' '}
            API
          </li>
        </ul>
      </section>

      <section class="features">
        <h2>Visualizations</h2>
        <h3>Web &amp; Android</h3>
        <ul>
          <li>
            Minutes in HR zones for last 7 days (due to the Galpin/Huberman recommendation to be in zone 2
            150-200 minutes per week and zone 5 5-10 minutes). Android also has a widget.
          </li>
        </ul>
        <h3>Web only</h3>
        <ul>
          <li>Timeline with Heartrate, tags, places etc...</li>
          <li>Location timeline with option to name the locations.</li>
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
    </>
  )
}

function LoggedInHome({ apiUrl }: { apiUrl: string }) {
  return (
    <>
      <section class="quickstart">
        <h2>Getting Started</h2>

        <h3>1. Android App (Health Connect)</h3>
        <p>
          <a
            href="https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the APK
          </a>{' '}
          to sync Android Health Connect data. Set API URL to: <code>{apiUrl}</code>
        </p>

        <h3>2. Location Tracking</h3>
        <p>
          Install{' '}
          <a href="https://owntracks.org/" target="_blank" rel="noopener noreferrer">
            OwnTracks
          </a>{' '}
          and configure it in HTTP mode.{' '}
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/owntracks.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Setup guide
          </a>
        </p>

        <h3>3. Oura Ring</h3>
        <p>
          Create an app at{' '}
          <a href="https://cloud.ouraring.com/v2/docs" target="_blank" rel="noopener noreferrer">
            Oura Cloud
          </a>{' '}
          (My Applications → New Application). Add <code>OURA_CLIENT</code> and <code>OURA_SECRET</code> to
          your docker-compose.yml, then connect in <a href="/settings">Settings</a>.
        </p>

        <h3>4. RescueTime</h3>
        <p>
          Get your API key from{' '}
          <a href="https://www.rescuetime.com/anapi/manage" target="_blank" rel="noopener noreferrer">
            RescueTime API settings
          </a>
          , then add it in <a href="/settings">Settings</a>.
        </p>

        <h3>5. AI Integration (MCP)</h3>
        <p>
          Connect{' '}
          <a href="https://claude.ai/download" target="_blank" rel="noopener noreferrer">
            Claude Code
          </a>{' '}
          to query your health data. Add to <code>~/.claude/settings.json</code>:
        </p>
        <pre class="code-block">
          {`"mcpServers": {
  "aurboda": {
    "url": "${apiUrl}/mcp",
    "headers": { "Cookie": "auth=YOUR_AUTH_TOKEN" }
  }
}`}
        </pre>
        <p class="note">
          Tip: Use{' '}
          <a
            href="https://github.com/anthropics/claude-code/tree/main/happy-coder"
            target="_blank"
            rel="noopener noreferrer"
          >
            happy-coder
          </a>{' '}
          to access and discuss your health data on mobile.
        </p>
      </section>

      <section class="user-actions">
        <h2>Your Data</h2>
        <ul>
          <li>
            <a href="/hr-zones">HR zone minutes (last 7 days)</a>
          </li>
          <li>
            <a href="/timeline">Heart rate timeline</a>
          </li>
          <li>
            <a href="/places">Places</a>
          </li>
        </ul>
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

  // In dev: replace web port 8080 with backend port 3000
  // In prod: backend is at /api path on same origin
  const origin = window.location.origin
  const apiUrl =
    import.meta.env.VITE_API_URL ||
    (origin.includes(':8080') ? origin.replace(':8080', ':3000') : `${origin}/api`)

  return (
    <div class="home">
      <div class="hero">
        <img src="/logo.svg" alt="Aurboda logo" class="hero-logo" />
        <div class="hero-text">
          <h1>Aurboda</h1>
          <p class="subtitle">Self Quantification Aggregator</p>
        </div>
      </div>

      {isLoggedIn ?
        <LoggedInHome apiUrl={apiUrl} />
      : <GuestHome canSignup={canSignup} />}
    </div>
  )
}
