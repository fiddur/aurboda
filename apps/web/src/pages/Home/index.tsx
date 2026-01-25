import { auth } from '../../state/auth'

import './style.css'

export function Home() {
  const isLoggedIn = auth.value.token

  return (
    <div class="home">
      <header class="hero">
        <img src="/logo.svg" alt="Aurboda logo" class="hero-logo" />
        <div class="hero-text">
          <h1>Aurboda</h1>
          <p class="subtitle">Self Quantification Aggregator</p>
        </div>
      </header>

      <section class="intro">
        <p>
          In Norse mythology, Aurbo&eth;a is a mountain j&ouml;tunn (giantess) associated with strength and
          vitality. Her name, meaning "gravel-offerer" or "gold-offerer", reflects her role as a gatherer and
          provider.
        </p>
        <p>
          This project embodies that spirit: gathering scattered health data from multiple sources into a
          unified foundation for understanding your wellbeing.
        </p>
      </section>

      <section class="features">
        <h2>Data Sources</h2>
        <ul>
          <li>Android Health Connect (via Aurboda Android app)</li>
          <li>OwnTracks (location tracking)</li>
          <li>Oura Ring API</li>
          <li>RescueTime API</li>
        </ul>
      </section>

      <section class="features">
        <h2>Visualizations</h2>
        <ul>
          <li>Heart rate timeline</li>
          <li>Sleep data</li>
          <li>Exercise tracking</li>
          <li>Location history</li>
        </ul>
      </section>

      <section class="downloads">
        <h2>Downloads</h2>
        <p>
          <a
            href="https://github.com/fiddur/aurboda/actions/workflows/android.yml?query=branch%3Adevelop"
            target="_blank"
            rel="noopener noreferrer"
          >
            Android APK (latest build artifacts)
          </a>
        </p>
        <p class="note">
          Navigate to a successful workflow run and download the APK from the Artifacts section.
        </p>
      </section>

      {isLoggedIn && (
        <section class="user-actions">
          <h2>Your Data</h2>
          <p>
            <a href="/timeline">View your heart rate timeline</a>
          </p>
        </section>
      )}
    </div>
  )
}
