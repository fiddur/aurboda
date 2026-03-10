import { useQuery } from '@tanstack/react-query'
import { CustomMetricsSettings } from '../../components/CustomMetricsSettings'
import { GoalsSettings } from '../../components/GoalsSettings'
import { TagMappingsSettings } from '../../components/TagMappingsSettings'
import { fetchMetricTimeSeries, fetchUserSettings } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

const DATA_TYPES = ['Tags', 'Custom metrics', 'Manual data entry', 'Goals', 'Notes', 'Calories (computed)']

function CalorieEstimationStatus({
  hasBirthDate,
  hasSex,
  hasVo2Max,
}: {
  hasBirthDate: boolean
  hasSex: boolean
  hasVo2Max: boolean
}) {
  if (!hasSex) {
    return (
      <div class="status-banner not-connected">
        <span class="status-dot not-connected" />
        Calorie estimation is disabled — set your biological sex in <a href="/settings">Settings</a> to enable
        it.
      </div>
    )
  }
  if (!hasBirthDate) {
    return (
      <div class="status-banner not-connected">
        <span class="status-dot not-connected" />
        Birth date is required for calorie estimation — set it in <a href="/settings">Settings</a>.
      </div>
    )
  }
  if (!hasVo2Max) {
    return (
      <div class="status-banner not-connected">
        <span class="status-dot not-connected" />
        No VO2 max data found — using age/sex-based population averages for calorie estimation. Sync VO2 max
        from a fitness watch via Health Connect for more accurate results.
      </div>
    )
  }
  return (
    <div class="status-banner connected">
      <span class="status-dot connected" />
      Calorie estimation is active with measured VO2 max data.
    </div>
  )
}

export function AurbodaSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  // Check if VO2 max data exists (look back 90 days, matching calorie computation service)
  const { data: vo2MaxData } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => {
      const lookbackStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      return fetchMetricTimeSeries('vo2_max', lookbackStart, new Date())
    },
    queryKey: ['vo2max_check'],
    staleTime: 5 * 60 * 1000,
  })

  const hasVo2Max = (vo2MaxData?.length ?? 0) > 0
  const hasSex = !!userSettings?.sex
  const hasBirthDate = !!userSettings?.birth_date

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view data source settings.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
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

      <section class="settings-section">
        <h2>Calorie Estimation</h2>
        <p class="section-description">
          Aurboda computes per-minute active calorie burn from heart rate data using a metabolic formula. This
          applies to all HR data — sleep, exercise, and continuous monitoring.
        </p>
        <CalorieEstimationStatus hasBirthDate={hasBirthDate} hasSex={hasSex} hasVo2Max={hasVo2Max} />
      </section>

      <TagMappingsSettings />

      <CustomMetricsSettings />

      <GoalsSettings goals={userSettings?.goals ?? []} />
    </div>
  )
}
