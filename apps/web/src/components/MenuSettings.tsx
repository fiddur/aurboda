import { useState } from 'preact/hooks'

import { menuSettingsView } from './menu-settings'
import { toggleHiddenPage } from './nav-links'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import { useHiddenPages, useSetHiddenPages } from './useHiddenPages'

export function MenuSettings() {
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const hidden = useHiddenPages()
  const save = useSetHiddenPages({
    onError: (err) =>
      setStatus({ error: err instanceof Error ? err.message : 'Could not save', status: 'error' }),
    onSaved: () => setStatus({ status: 'saved', time: new Date() }),
  })
  const view = menuSettingsView(hidden)

  const submit = (next: string[]) => {
    setStatus({ status: 'saving' })
    save(next)
  }

  const toggle = (path: string) => (e: Event) =>
    submit(toggleHiddenPage(hidden, path, (e.target as HTMLInputElement).checked))

  return (
    <SettingsSection
      id="menu"
      title="Menu"
      description="Choose which pages show in the menu. A hidden page keeps its data and still opens from links and its address; Home, Settings, Help and Notifications always show."
      headerExtra={<SaveStatusIndicator state={status} />}
    >
      {view.hiddenCount > 0 && (
        <button type="button" class="btn-secondary menu-show-all" onClick={() => submit([])}>
          Show all pages ({view.hiddenCount} hidden)
        </button>
      )}
      {view.groups.map((group) => (
        <div class="menu-group" key={group.id}>
          <h4 class="menu-group-title">{group.label}</h4>
          {group.switches.map((item) => (
            <label class="menu-setting" key={item.path}>
              <span class="menu-setting-text">
                <strong>{item.label}</strong>
                <span class="menu-setting-description">{item.description}</span>
              </span>
              <input
                type="checkbox"
                class="menu-setting-switch"
                aria-label={`Show ${item.label} in the menu`}
                checked={item.shown}
                onChange={toggle(item.path)}
              />
            </label>
          ))}
        </div>
      ))}
    </SettingsSection>
  )
}
