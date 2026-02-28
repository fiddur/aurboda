import { useQuery } from '@tanstack/react-query'
import { CustomMetricsSettings } from '../../components/CustomMetricsSettings'
import { GoalsSettings } from '../../components/GoalsSettings'
import { TagMappingsSettings } from '../../components/TagMappingsSettings'
import { fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

const DATA_TYPES = ['Tags', 'Custom metrics', 'Manual data entry', 'Goals', 'Notes']

export function AurbodaSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view data source settings.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <a href="/data-sources" class="back-link">
        &larr; All Data Sources
      </a>

      <div class="page-header">
        <h1>Aurboda (Web / API / MCP)</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          The Aurboda web app, REST API, and MCP tools are always available as a data source. You can manually
          add tags, record custom metrics, set goals, and annotate your data with notes. This is the native
          data entry layer — everything you add through the web UI, API calls, or AI assistant interactions
          lives here.
        </p>

        <div class="data-types-section">
          <h2>Data provided</h2>
          <div class="data-types-list">
            {DATA_TYPES.map((dt) => (
              <span key={dt} class="data-type-badge">
                {dt}
              </span>
            ))}
          </div>
        </div>

        <div class="status-banner connected">
          <span class="status-dot connected" /> Always available — no setup required
        </div>
      </div>

      <TagMappingsSettings />

      <CustomMetricsSettings />

      <GoalsSettings goals={userSettings?.goals ?? []} />
    </div>
  )
}
