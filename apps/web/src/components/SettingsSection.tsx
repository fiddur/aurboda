import type { ComponentChildren } from 'preact'

import './SettingsSection.css'

interface SettingsSectionProps {
  title: string
  description?: string
  class?: string
  headerExtra?: ComponentChildren
  isLoading?: boolean
  loadingMessage?: string
  isEmpty?: boolean
  emptyMessage?: string
  children?: ComponentChildren
}

export function SettingsSection(props: SettingsSectionProps) {
  return (
    <section class={`settings-section ${props.class ?? ''}`}>
      <div class="section-header">
        <h2>{props.title}</h2>
        {props.headerExtra}
      </div>
      {props.description && <p class="section-description">{props.description}</p>}
      {props.isLoading ? (
        <p class="loading">{props.loadingMessage ?? 'Loading...'}</p>
      ) : props.isEmpty ? (
        <p class="no-data">{props.emptyMessage}</p>
      ) : (
        props.children
      )}
    </section>
  )
}
