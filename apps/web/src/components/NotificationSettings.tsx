import type { NotificationTypeSetting, SetNotificationPreferenceBody } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchNotificationTypes, setNotificationPreference } from '../state/api'
import { groupNotificationSettings } from './notifications'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

const TYPES_KEY = ['notifications', 'types'] as const
const SECTION_ID = 'notifications'

const GROUP_HELP: Record<string, string> = {
  feed: 'New posts follow the bell on each account in your Following list; this switch turns the whole kind on or off.',
}

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
      {groupNotificationSettings(types ?? []).map((group) => (
        <div class="notification-group" key={group.group}>
          <div class="notification-group-header">
            <h4 class="notification-group-title">{group.label}</h4>
            <span class="notification-group-column">In-app</span>
            <span class="notification-group-column">Push</span>
          </div>
          {GROUP_HELP[group.group] && <p class="field-description">{GROUP_HELP[group.group]}</p>}
          {group.types.map((setting) => (
            <div class="notification-setting" key={setting.type}>
              <div class="notification-setting-text">
                <strong>{setting.label}</strong>
                <span class="notification-setting-description">{setting.description}</span>
              </div>
              <input
                type="checkbox"
                class="notification-setting-switch"
                aria-label={`${setting.label}: in-app`}
                checked={setting.in_app}
                onChange={toggle(setting.type, 'in_app')}
              />
              <input
                type="checkbox"
                class="notification-setting-switch"
                aria-label={`${setting.label}: push`}
                checked={setting.push}
                onChange={toggle(setting.type, 'push')}
              />
            </div>
          ))}
        </div>
      ))}
    </SettingsSection>
  )
}
