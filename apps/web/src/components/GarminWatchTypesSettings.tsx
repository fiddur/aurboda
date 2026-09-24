import type { GarminWatchType, UserSettingsResponse } from '@aurboda/api-spec'

import { garminWatchSessionNameMaxLength } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { fetchActivityTypeDefinitions, fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { toDisplayName } from '../utils/displayName'
import { ActivityTypePicker } from './ActivityTypePicker'
import {
  addWatchType,
  moveWatchType,
  parseSportOptionValue,
  removeWatchType,
  renameWatchType,
  setWatchTypeSport,
  sportOptionsFor,
  sportOptionValue,
} from './garmin-watch-types'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import './GarminWatchTypesSettings.css'

function WatchTypeRow({
  entry,
  displayName,
  isFirst,
  isLast,
  onChange,
}: {
  entry: GarminWatchType
  displayName: string
  isFirst: boolean
  isLast: boolean
  onChange: (update: (types: GarminWatchType[]) => GarminWatchType[]) => void
}) {
  const [draftName, setDraftName] = useState(entry.session_name)

  useEffect(() => {
    setDraftName(entry.session_name)
  }, [entry.session_name])

  const commitName = () => {
    const trimmed = draftName.trim()
    if (!trimmed) {
      setDraftName(entry.session_name)
      return
    }
    if (trimmed !== entry.session_name) {
      onChange((types) => renameWatchType(types, entry.activity_type, trimmed))
    }
  }

  const type = entry.activity_type

  return (
    <li class="watch-type-row">
      <span class="watch-type-name">{displayName}</span>
      <label class="watch-type-field">
        <span>Label</span>
        <input
          type="text"
          value={draftName}
          maxLength={garminWatchSessionNameMaxLength}
          required
          onInput={(e) => setDraftName((e.target as HTMLInputElement).value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitName()
            }
          }}
        />
      </label>
      <label class="watch-type-field">
        <span>Garmin sport</span>
        <select
          value={sportOptionValue(entry.fit_sport, entry.fit_sub_sport)}
          onChange={(e) => {
            const parsed = parseSportOptionValue((e.target as HTMLSelectElement).value)
            if (parsed) onChange((types) => setWatchTypeSport(types, type, parsed.sport, parsed.sub_sport))
          }}
        >
          {sportOptionsFor(entry.fit_sport, entry.fit_sub_sport).map((s) => (
            <option
              key={sportOptionValue(s.sport, s.sub_sport)}
              value={sportOptionValue(s.sport, s.sub_sport)}
            >
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div class="watch-type-actions">
        <button
          type="button"
          class="watch-type-move"
          disabled={isFirst}
          onClick={() => onChange((types) => moveWatchType(types, type, -1))}
          aria-label={`Move ${displayName} up`}
        >
          ↑
        </button>
        <button
          type="button"
          class="watch-type-move"
          disabled={isLast}
          onClick={() => onChange((types) => moveWatchType(types, type, 1))}
          aria-label={`Move ${displayName} down`}
        >
          ↓
        </button>
        <button
          type="button"
          class="watch-type-remove"
          onClick={() => onChange((types) => removeWatchType(types, type))}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export function GarminWatchTypesSettings() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const { data: typeDefs = [] } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 30 * 60 * 1000,
  })

  const [pendingType, setPendingType] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const watchTypes = settings?.garmin_watch_types ?? []

  const displayNameOf = (activityType: string): string =>
    typeDefs.find((d) => d.name === activityType)?.display_name || toDisplayName(activityType)

  const saveMutation = useMutation({
    mutationFn: updateUserSettings,
    onError: (err) => {
      setSaveStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved', time: new Date() })
    },
  })

  const change = (update: (types: GarminWatchType[]) => GarminWatchType[]) => {
    const current = queryClient.getQueryData<UserSettingsResponse>(['userSettings'])
    if (!current) return
    const next = update(current.garmin_watch_types ?? [])
    if (next === current.garmin_watch_types) return
    queryClient.setQueryData<UserSettingsResponse>(['userSettings'], { ...current, garmin_watch_types: next })
    setSaveStatus({ status: 'saving' })
    saveMutation.mutate({ garmin_watch_types: next })
  }

  const addPending = () => {
    if (!pendingType) return
    change((types) => addWatchType(types, pendingType, displayNameOf(pendingType)))
    setPendingType('')
  }

  const pendingAlreadyAdded = watchTypes.some((t) => t.activity_type === pendingType)

  return (
    <section class="settings-section garmin-watch-types">
      <div class="section-header-row">
        <h2>Watch app</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <p class="field-description">
        The Aurboda watch app offers these activity types, in this order. The label is what the watch shows;
        the Garmin sport is what Garmin Connect records and displays, since Connect does not keep the label.
        Aurboda recognises the type again when the activity syncs from Garmin.
      </p>
      <p class="field-description">
        To connect the watch app, open its settings in the Garmin Connect phone app and enter the API URL (
        <code>{`${window.location.origin}/api`}</code>) and an API token, which you can generate on the{' '}
        <a href="/data-sources/activitywatch-desktop">ActivityWatch page</a>.
      </p>

      {isLoading ? (
        <div class="loading">Loading...</div>
      ) : (
        <>
          {watchTypes.length === 0 ? (
            <p class="field-description">
              No activity types configured yet. The watch app shows nothing until you add one.
            </p>
          ) : (
            <ol class="watch-type-list">
              {watchTypes.map((entry, index) => (
                <WatchTypeRow
                  key={entry.activity_type}
                  entry={entry}
                  displayName={displayNameOf(entry.activity_type)}
                  isFirst={index === 0}
                  isLast={index === watchTypes.length - 1}
                  onChange={change}
                />
              ))}
            </ol>
          )}

          <div class="watch-type-add">
            <ActivityTypePicker
              value={pendingType}
              onChange={setPendingType}
              placeholder="Add activity type..."
            />
            <button
              type="button"
              class="connect-button"
              disabled={!pendingType || pendingAlreadyAdded}
              onClick={addPending}
            >
              Add
            </button>
          </div>
          {pendingAlreadyAdded && <p class="field-description">That type is already on the watch.</p>}
        </>
      )}
    </section>
  )
}
