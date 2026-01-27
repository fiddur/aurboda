import { auth, signupAllowed } from '../../state/auth'

import './style.css'

export function Home() {
  const isLoggedIn = auth.value.token
  const canSignup = signupAllowed.value

  return (
    <div class="home">
      <div class="hero">
        <img src="/logo.svg" alt="Aurboda logo" class="hero-logo" />
        <div class="hero-text">
          <h1>Aurboda</h1>
          <p class="subtitle">Self Quantification Aggregator</p>
        </div>
      </div>

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

      {isLoggedIn && (
        <section class="user-actions">
          <h2>Your Data</h2>
          <ul>
            <li>
              <a href="/hr-zones">View HR zone minutes (last 7 days)</a>
            </li>
            <li>
              <a href="/timeline">View your heart rate timeline</a>
            </li>
            <li>
              <a href="/places">View your places</a>
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
