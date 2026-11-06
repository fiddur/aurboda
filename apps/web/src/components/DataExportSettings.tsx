import { useState } from 'preact/hooks'

import { apiErrorMessage, requestExportDumpLink } from '../state/api'
import { SettingsSection } from './SettingsSection'

const DOCS_URL = 'https://github.com/fiddur/aurboda/blob/develop/docs/data-export.md'

export function DataExportSettings() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDownload = async () => {
    setError(null)
    setBusy(true)
    try {
      const { url } = await requestExportDumpLink()
      window.location.href = url
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start the export'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title="Export all data">
      <p class="section-description">
        Download a complete copy of your database as a gzipped SQL file, which you can restore into another
        Aurboda installation or query with standard PostgreSQL tools. <a href={DOCS_URL}>How to restore it</a>
        .
      </p>
      <p class="field-description">
        The export includes the credentials Aurboda stores for your integrations (e.g. Garmin and Oura
        tokens), so keep the file safe.
      </p>
      <button type="button" class="primary" disabled={busy} onClick={onDownload}>
        {busy ? 'Preparing export…' : 'Download export'}
      </button>
      {error && <p class="error">{error}</p>}
    </SettingsSection>
  )
}
