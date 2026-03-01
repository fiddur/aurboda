/**
 * Shared components for data source pages — save status indicators, status banners, etc.
 */

export type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }

export function SaveStatusIndicator({ saveStatus }: { saveStatus: SaveStatus }) {
  if (saveStatus.status === 'idle') return null
  return (
    <>
      {saveStatus.status === 'saving' && <span class="save-indicator saving">Saving...</span>}
      {saveStatus.status === 'saved' && <span class="save-indicator saved">Saved</span>}
      {saveStatus.status === 'error' && <span class="save-indicator error">{saveStatus.error}</span>}
    </>
  )
}

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
