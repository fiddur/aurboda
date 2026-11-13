import type { NotificationTypeSetting, SetNotificationPreferenceBody } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchNotificationTypes, setNotificationPreference } from '../state/api'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

const TYPES_KEY = ['notifications', 'types'] as const
const SECTION_ID = 'notifications'

export function NotificationSettings() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const scrolled = useRef(false)
  const { data: types, isLoading, error } = useQuery({ queryFn: fetchNotificationTypes, queryKey: TYPES_KEY })

  useEffect(() => {
    if (scrolled.current || types === undefined || window.location.hash !== `#${SECTION_ID}`) return
    scrolled.current = true
    document.getElementById(SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [types])

  const save = useMutation({
    mutationFn: ({ type, patch }: { type: string; patch: SetNotificationPreferenceBody }) =>
      setNotificationPreference(type, patch),
    onError: (err) => {
      setStatus({ error: err instanceof Error ? err.message : 'Could not save', status: 'error' })
      void queryClient.invalidateQueries({ queryKey: TYPES_KEY })
    },
    onMutate: ({ type, patch }) => {
      setStatus({ status: 'saving' })
      queryClient.setQueryData<NotificationTypeSetting[]>(TYPES_KEY, (current) =>
        current?.map((setting) => (setting.type === type ? { ...setting, ...patch } : setting)),
      )
    },
    onSuccess: (setting) => {
      setStatus({ status: 'saved', time: new Date() })
      if (!setting) return
      queryClient.setQueryData<NotificationTypeSetting[]>(TYPES_KEY, (current) =>
        current?.map((existing) => (existing.type === setting.type ? setting : existing)),
      )
    },
  })

  const toggle = (type: string, field: 'in_app' | 'push') => (e: Event) =>
    save.mutate({ patch: { [field]: (e.target as HTMLInputElement).checked }, type })

  return (
    <SettingsSection
      id={SECTION_ID}
      title="Notifications"
      description="In-app notifications show under the 🛎️ bell. Push notifications are delivered by the Aurboda Android app."
      headerExtra={<SaveStatusIndicator state={status} />}
      isLoading={isLoading}
      isEmpty={!isLoading && (error !== null || (types?.length ?? 0) === 0)}
      emptyMessage={
        error ? 'Could not load notification settings.' : 'No notification types to configure yet.'
      }
    >
      {types?.map((setting) => (
        <div class="form-field notification-setting" key={setting.type}>
          <p class="notification-setting-label">
            <strong>{setting.label}</strong>
            {setting.admin_only && <span class="notification-setting-admin"> (admins)</span>}
          </p>
          <p class="field-description">{setting.description}</p>
          <div class="notification-setting-switches">
            <label class="checkbox-field">
              <input type="checkbox" checked={setting.in_app} onChange={toggle(setting.type, 'in_app')} />
              <span>In-app</span>
            </label>
            <label class="checkbox-field">
              <input type="checkbox" checked={setting.push} onChange={toggle(setting.type, 'push')} />
              <span>Push</span>
            </label>
          </div>
        </div>
      ))}
    </SettingsSection>
  )
}
