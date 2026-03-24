import '../Home/style.css'

export function Privacy() {
  return (
    <div class="home">
      <h1>Privacy Policy</h1>
      <p>
        <em>Last updated: 2026-03-24</em>
      </p>

      <section>
        <h2>Overview</h2>
        <p>
          Aurboda is a self-hosted health data aggregation platform. Your data stays on the server you or your
          administrator control. We do not sell, share, or transfer your personal data to any third parties.
        </p>
      </section>

      <section>
        <h2>Data We Collect</h2>
        <p>Aurboda stores the health and activity data you choose to connect:</p>
        <ul>
          <li>Health metrics (heart rate, HRV, sleep, exercise, steps, weight, SpO2, etc.)</li>
          <li>Location data (GPS positions, place visits) if OwnTracks is connected</li>
          <li>Screen time and app usage if RescueTime or ActivityWatch is connected</li>
          <li>Music listening history if Last.fm is connected</li>
          <li>Calendar events if calendar feeds are connected</li>
          <li>Account credentials (username, hashed password) for authentication</li>
        </ul>
      </section>

      <section>
        <h2>How Data Is Used</h2>
        <p>Your data is used solely to provide the Aurboda service to you:</p>
        <ul>
          <li>Displaying visualizations, trends, and correlations</li>
          <li>Providing data to AI assistants via MCP when you choose to connect them</li>
          <li>Generating statistical analyses (correlations, training load, goals)</li>
        </ul>
      </section>

      <section>
        <h2>Data Sharing</h2>
        <p>
          <strong>We do not share your data with any third parties.</strong> Your data remains on the Aurboda
          server instance. The only external communication is with the data source APIs you have explicitly
          configured (Oura, Garmin, RescueTime, Last.fm, etc.) to fetch your own data.
        </p>
      </section>

      <section>
        <h2>Data Storage</h2>
        <p>
          All data is stored in a PostgreSQL database on the server running the Aurboda instance. Data
          retention and backups are managed by whoever administers the server.
        </p>
      </section>

      <section>
        <h2>Your Rights</h2>
        <p>
          You can view, export, or delete your data at any time through the Aurboda interface, REST API, or
          MCP tools. Contact your server administrator for account deletion.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For questions about this policy, contact the project maintainer via{' '}
          <a href="https://www.reddit.com/user/fiddur/" target="_blank" rel="noopener noreferrer">
            reddit
          </a>{' '}
          or through{' '}
          <a href="https://github.com/fiddur/aurboda" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </section>
    </div>
  )
}
