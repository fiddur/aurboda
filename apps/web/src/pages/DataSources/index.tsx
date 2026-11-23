import type { DataKindOverview, DataSourceOverviewItem, DataSourcesOverview } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchDataSourcesOverview } from '../../state/api'
import { auth } from '../../state/auth'
import { overlapMessage, sourcesByGroup } from './overview'
import { SyncIntervalField } from './shared'
import './style.css'

const kindLabel = (overview: DataSourcesOverview, id: DataKindOverview['id']): string =>
  overview.kinds.find((kind) => kind.id === id)?.label ?? id

function SourceCard({ source, overview }: { source: DataSourceOverviewItem; overview: DataSourcesOverview }) {
  const state = source.status === 'active' ? 'connected' : 'not-connected'
  return (
    <a href={source.path} class={`source-card ${state}`}>
      <div class="source-card-header">
        <span class={`status-dot ${state}`} />
        <h3>{source.name}</h3>
      </div>
      <ul class="source-kind-chips">
        {source.kinds.map((kind) => (
          <li key={kind} class="source-kind-chip">
            {kindLabel(overview, kind)}
          </li>
        ))}
      </ul>
      <p class={`source-status-text ${state}`}>{source.detail}</p>
    </a>
  )
}

function SourceChip({ source, available }: { source: DataSourceOverviewItem; available?: boolean }) {
  return (
    <a href={source.path} class={`collect-source-chip${available ? ' available' : ''}`}>
      {source.name}
    </a>
  )
}

function KindRow({ kind, overview }: { kind: DataKindOverview; overview: DataSourcesOverview }) {
  const byId = (id: DataSourceOverviewItem['id']) => overview.sources.find((source) => source.id === id)
  const active = kind.active_sources.flatMap((id) => byId(id) ?? [])
  const available = kind.available_sources.flatMap((id) => byId(id) ?? [])
  const state = kind.overlap ? 'overlap' : active.length > 0 ? 'collected' : 'missing'
  return (
    <li class={`collect-row ${state}`}>
      <div class="collect-row-main">
        <span class={`collect-dot ${state}`} />
        <span class="collect-label">{kind.label}</span>
        <span class="collect-sources">
          {active.length > 0 ? (
            active.map((source) => <SourceChip key={source.id} source={source} />)
          ) : (
            <>
              <span class="collect-missing">Not collected. Add:</span>
              {available.map((source) => (
                <SourceChip key={source.id} source={source} available />
              ))}
            </>
          )}
        </span>
      </div>
      {kind.overlap && <p class="collect-overlap">{overlapMessage(kind, overview.sources)}</p>}
    </li>
  )
}

function WhatYouCollect({ overview }: { overview: DataSourcesOverview }) {
  return (
    <section class="what-you-collect">
      <h2>What you collect</h2>
      <ul class="collect-list">
        {overview.kinds.map((kind) => (
          <KindRow key={kind.id} kind={kind} overview={overview} />
        ))}
      </ul>
    </section>
  )
}

export function DataSources() {
  const isLoggedIn = auth.value.token

  const overviewQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchDataSourcesOverview,
    queryKey: ['dataSourcesOverview'],
    staleTime: 60 * 1000,
  })
  const overview = overviewQuery.data

  if (!isLoggedIn) {
    return (
      <div class="page page--full data-sources-page">
        <h1>Data Sources</h1>
        <p>Please log in to see your data sources and setup guides.</p>
        <a href="/login" class="external-link" style={{ display: 'inline-block', marginTop: '1rem' }}>
          Log in
        </a>
      </div>
    )
  }

  return (
    <div class="page page--full data-sources-page">
      <div class="page-header">
        <h1>Data Sources</h1>
        <p class="page-subtitle">
          What you collect, and where it comes from. Connect whatever you already use; one source per kind of
          data is usually enough.
        </p>
      </div>

      {overviewQuery.isLoading && <div class="loading">Checking your data sources...</div>}
      {overviewQuery.isError && <p class="field-description warning">Could not load your data sources.</p>}

      {overview && (
        <>
          <WhatYouCollect overview={overview} />
          {sourcesByGroup(overview).map((group) => (
            <section key={group.id} class="source-group">
              <h2>{group.label}</h2>
              <div class="sources-grid">
                {group.sources.map((source) => (
                  <SourceCard key={source.id} source={source} overview={overview} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <SyncIntervalField provider="default" />

      <section class="getting-started-tips">
        <h2>Tips</h2>
        <ul>
          <li>
            <strong>Getting started:</strong> Install the Aurboda Android app for heart rate, sleep, and
            exercise data via Health Connect. Then add more sources as needed.
          </li>
          <li>
            <strong>Screen time:</strong> Use ActivityWatch (desktop or mobile) or RescueTime to track app and
            website usage. Both feed into the Screen Time view.
          </li>
          <li>
            <strong>AI analysis:</strong> Once you have data, you can use Claude or other MCP-compatible AI
            assistants to analyze your health trends.
          </li>
          <li>
            <strong>Goals:</strong> Set up weekly goals in the Aurboda (Web/API) data source page to track
            your progress toward health targets.
          </li>
        </ul>
      </section>
    </div>
  )
}
