import '../Home/style.css'

export function Terms() {
  return (
    <div class="home">
      <h1>Terms of Service</h1>
      <p>
        <em>Last updated: 2026-03-24</em>
      </p>

      <section>
        <h2>Acceptance</h2>
        <p>
          By using Aurboda, you agree to these terms. Aurboda is provided as open-source software under the{' '}
          <a href="http://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
            GNU AGPL-3.0 license
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Access</h2>
        <p>
          Aurboda does not offer public registration. Access to any hosted instance is by invitation only.
          Self-hosting is available to anyone under the terms of the AGPL-3.0 license.
        </p>
      </section>

      <section>
        <h2>Your Data</h2>
        <p>
          You retain ownership of all data you store in Aurboda. The service aggregates data from sources you
          explicitly connect and does not claim any rights to your data. See our{' '}
          <a href="/privacy">Privacy Policy</a> for details on how data is handled.
        </p>
      </section>

      <section>
        <h2>Third-Party Services</h2>
        <p>
          Aurboda connects to third-party APIs (Oura, Garmin, RescueTime, Last.fm, etc.) on your behalf to
          fetch your data. Your use of those services is governed by their respective terms and privacy
          policies. Aurboda only reads data from these services — it does not write to or modify your data on
          third-party platforms.
        </p>
      </section>

      <section>
        <h2>Disclaimer</h2>
        <p>
          Aurboda is provided "as is" without warranty of any kind. It is not a medical device and should not
          be used for medical diagnosis or treatment decisions. The visualizations, correlations, and AI
          insights are for informational purposes only.
        </p>
      </section>

      <section>
        <h2>Limitation of Liability</h2>
        <p>
          The maintainers and contributors of Aurboda are not liable for any damages arising from your use of
          the software, including but not limited to data loss, service interruptions, or decisions made based
          on information provided by the platform.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may be updated from time to time. Continued use of the service constitutes acceptance of
          the updated terms.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For questions about these terms, contact the project maintainer via{' '}
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
