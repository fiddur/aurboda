/**
 * Shared components for data source pages — save status indicators, status banners, etc.
 */
export { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'

export function StatusBanner({ connected, label }: { connected: boolean; label: string }) {
  return (
    <div class={`status-banner ${connected ? 'connected' : 'not-connected'}`}>
      <span class={`status-dot ${connected ? 'connected' : 'not-connected'}`} />
      {label}
    </div>
  )
}

export function DataTypesList({ types }: { types: string[] }) {
  return (
    <div class="data-types-section">
      <h2>Data provided</h2>
      <div class="data-types-list">
        {types.map((dt) => (
          <span key={dt} class="data-type-badge">
            {dt}
          </span>
        ))}
      </div>
    </div>
  )
}

export function LoginRequired() {
  return (
    <div class="data-sources-page">
      <p>Please log in to view data source settings.</p>
    </div>
  )
}
