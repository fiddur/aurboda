import { auth } from '../../state/auth'

import './style.css'

export function Home() {
  const isLoggedIn = auth.value.token

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
        <p>Gather all your Self Quantification data into one place.</p>
        <p>
          The aim is to gather and visualize all relevant data, offer a connection with your AI agent, find
          correlations. Current state:
        </p>
        <ul>
          <li>
            Aurboda backend offers an API and MCP to fetch and discuss the data with an AI (Claude, or any
            that uses MCP). It also detects locations and geocodes, offering the user to name visited
            locations.
          </li>
          <li>
            Aurboda Android funnels Health Connect data into the backend, and shows minutes in HR zones for
            last week, also with a widget.
          </li>
          <li>Aurboda web offers timeline visualizations and location timeline naming (very early stage).</li>
        </ul>
        <p class="note">
          I currently don't offer any public signup, but contact me through{' '}
          <a href="https://www.reddit.com/user/fiddur/" target="_blank" rel="noopener noreferrer">
            reddit
          </a>
          .
        </p>
      </section>

      <section class="name">
        <h2>Name</h2>
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
        <h3>Web</h3>
        <ul>
          <li>Timeline with Heartrate, tags, places etc...</li>
          <li>Location timeline with option to name the locations.</li>
        </ul>
        <h3>Android app</h3>
        <ul>
          <li>
            Minutes in HR zones for last 7 days (due to the Galpin/Huberman recommendation to be in zone 2
            150-200 minutes per week and zone 5 5-10 minutes), with a widget.
          </li>
        </ul>
      </section>

      <section class="downloads">
        <h2>Downloads</h2>
        <p>
          <a
            href="https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk"
            target="_blank"
            rel="noopener noreferrer"
          >
            Android APK
          </a>
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
