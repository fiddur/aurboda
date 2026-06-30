/**
 * PublicDashboard - read-only view of a shared dashboard at
 * /u/:username/:slug. Unauthenticated; renders each widget from the
 * server-resolved `widget_data` via PublicWidgetRenderer (no data is fetched
 * per widget). Rendered without app chrome.
 */
import type { SectionType } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import { PublicWidgetRenderer } from '../../components/widgets'
import { fetchPublicSharedDashboard } from '../../state/api'
import '../Dashboard/style.css'
import './style.css'

const gridClass = (type: SectionType): string =>
  type === 'links' ? 'links-grid' : type === 'charts' ? 'charts-grid' : 'metrics-grid'

export function PublicDashboard() {
  const { params } = useRoute()
  const username = params.username
  const slug = params.slug

  const query = useQuery({
    queryFn: () => fetchPublicSharedDashboard(username, slug),
    queryKey: ['publicSharedDashboard', username, slug],
    retry: false,
    staleTime: 60 * 1000,
  })

  if (query.isLoading) {
    return (
      <div class="public-dashboard">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  if (query.isError || !query.data?.success || !query.data.config) {
    return (
      <div class="public-dashboard">
        <h1>Dashboard not found</h1>
        <p class="public-muted">This shared dashboard does not exist or is no longer available.</p>
      </div>
    )
  }

  const { config, name, widget_data } = query.data

  return (
    <div class="dashboard public-dashboard">
      <div class="dashboard-header">
        <h1>{name}</h1>
        <a class="public-attribution" href={`/u/${encodeURIComponent(username)}`}>
          @{username}
        </a>
      </div>

      <div class="sections-grid">
        {config.sections.map((section) => (
          <section key={section.id} class="metrics-section">
            <div class="section-header">
              <h2>{section.title}</h2>
            </div>
            <div class={gridClass(section.type)}>
              {section.widgets.map((widget) => (
                <PublicWidgetRenderer key={widget.id} widget={widget} data={widget_data?.[widget.id]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
