import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  deleteLastFmTagRule,
  fetchLastFmTagRules,
  fetchUserSettings,
  updateLastFmTagRule,
  type LastFmMatchMode,
  type LastFmMatchType,
  type LastFmTagRule,
  type UpdateLastFmTagRuleBody,
} from '../../state/api'
import { auth } from '../../state/auth'
import { AddRuleForm } from './AddRuleForm'
import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; time?: Date; error?: string }

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Failed to save')

function SaveIndicator({ saveStatus }: { saveStatus: SaveStatus }) {
  if (saveStatus.status === 'idle') return null
  const messages: Record<string, string> = {
    error: saveStatus.error ?? 'Error',
    saved: 'Rule saved',
    saving: 'Saving...',
  }
  return <span class={`save-indicator ${saveStatus.status}`}>{messages[saveStatus.status]}</span>
}

const needsTrack = (matchType: LastFmMatchType): boolean =>
  matchType === 'track' || matchType === 'track_artist'

const needsArtist = (matchType: LastFmMatchType): boolean =>
  matchType === 'artist' || matchType === 'track_artist'

const validateRuleForm = (
  matchType: LastFmMatchType,
  trackName: string,
  artistName: string,
  artistNames: string[],
): string | null => {
  if (needsTrack(matchType) && !trackName.trim()) return 'Track name is required'
  if (needsArtist(matchType) && !artistNames.length && !artistName.trim()) {
    return 'At least one artist name is required'
  }
  return null
}

const formatRuleArtists = (rule: LastFmTagRule): string => {
  if (rule.artist_names && rule.artist_names.length > 0) {
    return rule.artist_names.join(', ')
  }
  return rule.artist_name ?? ''
}

const formatRuleDescription = (rule: LastFmTagRule): string => {
  let desc = ''
  if (rule.match_type === 'track') desc = `Track: "${rule.track_name}"`
  else if (rule.match_type === 'artist') desc = `Artist: "${formatRuleArtists(rule)}"`
  else if (rule.match_type === 'track_artist') desc = `"${rule.track_name}" by "${formatRuleArtists(rule)}"`
  if (rule.match_mode === 'contains') desc += ' (contains)'
  return desc
}

const artistNamesChanged = (editNames: string[], original: string[]): boolean =>
  editNames.length !== original.length || editNames.some((n, i) => n !== original[i])

/** Compute changed artist fields, if any. */
function getArtistUpdates(
  rule: LastFmTagRule,
  editArtistNames: string[],
  editArtistName: string,
): Partial<UpdateLastFmTagRuleBody> {
  if (editArtistNames.length > 0) {
    return artistNamesChanged(editArtistNames, rule.artist_names ?? [])
      ? { artist_names: editArtistNames }
      : {}
  }
  return editArtistName.trim() !== (rule.artist_name ?? '') ? { artist_name: editArtistName.trim() } : {}
}

/** Parse gap minutes string to seconds (or null). */
const parseGapSeconds = (mergeGapMinutes: string): number | null => {
  const gapMinutes = parseFloat(mergeGapMinutes)
  return gapMinutes > 0 ? Math.round(gapMinutes * 60) : null
}

/** Build a partial update body by comparing edit state to the original rule. */
function buildUpdateBody(
  rule: LastFmTagRule,
  edit: {
    ruleName: string
    tagName: string
    matchType: LastFmMatchType
    matchMode: LastFmMatchMode
    trackName: string
    artistName: string
    artistNames: string[]
    mergeGapMinutes: string
  },
): UpdateLastFmTagRuleBody {
  const body: UpdateLastFmTagRuleBody = {}

  if (edit.ruleName.trim() !== rule.rule_name) body.rule_name = edit.ruleName.trim()
  if (edit.tagName.trim() !== rule.tag_name) body.tag_name = edit.tagName.trim()
  if (edit.matchType !== rule.match_type) body.match_type = edit.matchType
  if (edit.matchMode !== rule.match_mode) body.match_mode = edit.matchMode

  if (needsTrack(edit.matchType) && edit.trackName.trim() !== (rule.track_name ?? '')) {
    body.track_name = edit.trackName.trim()
  }
  if (needsArtist(edit.matchType)) {
    Object.assign(body, getArtistUpdates(rule, edit.artistNames, edit.artistName))
  }

  const newGapSeconds = parseGapSeconds(edit.mergeGapMinutes)
  if (newGapSeconds !== (rule.merge_gap_seconds ?? null)) {
    body.merge_gap_seconds = newGapSeconds
  }

  return body
}

/** Inline edit form for an existing rule. */
function RuleEditForm({
  rule,
  onSaved,
  onCancel,
}: {
  rule: LastFmTagRule
  onSaved: () => void
  onCancel: () => void
}) {
  const [editRuleName, setEditRuleName] = useState(rule.rule_name)
  const [editTagName, setEditTagName] = useState(rule.tag_name)
  const [editMatchType, setEditMatchType] = useState<LastFmMatchType>(rule.match_type)
  const [editMatchMode, setEditMatchMode] = useState<LastFmMatchMode>(rule.match_mode)
  const [editTrackName, setEditTrackName] = useState(rule.track_name ?? '')
  const [editArtistName, setEditArtistName] = useState(rule.artist_name ?? '')
  const [editArtistNames, setEditArtistNames] = useState<string[]>(rule.artist_names ?? [])
  const [editNewArtistInput, setEditNewArtistInput] = useState('')
  const [editMergeGapMinutes, setEditMergeGapMinutes] = useState(
    rule.merge_gap_seconds ? String(Math.round(rule.merge_gap_seconds / 60)) : '',
  )

  const handleEditAddArtist = () => {
    const name = editNewArtistInput.trim()
    if (name && !editArtistNames.includes(name)) {
      setEditArtistNames([...editArtistNames, name])
      setEditNewArtistInput('')
    }
  }

  const updateMutation = useMutation({
    mutationFn: () => {
      const body = buildUpdateBody(rule, {
        artistName: editArtistName,
        artistNames: editArtistNames,
        matchMode: editMatchMode,
        matchType: editMatchType,
        mergeGapMinutes: editMergeGapMinutes,
        ruleName: editRuleName,
        tagName: editTagName,
        trackName: editTrackName,
      })
      return updateLastFmTagRule(rule.id, body)
    },
    onSuccess: onSaved,
  })

  const validationError = validateRuleForm(editMatchType, editTrackName, editArtistName, editArtistNames)
  const canSave = editRuleName.trim() && editTagName.trim() && !validationError

  return (
    <div class="rule-item editing">
      <div class="rule-edit-fields">
        <div class="form-row">
          <div class="form-field">
            <label>Rule Name</label>
            <input
              type="text"
              value={editRuleName}
              onInput={(e) => setEditRuleName((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-field">
            <label>Tag to Create</label>
            <input
              type="text"
              value={editTagName}
              onInput={(e) => setEditTagName((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>Match Type</label>
            <select
              value={editMatchType}
              onChange={(e) => setEditMatchType((e.target as HTMLSelectElement).value as LastFmMatchType)}
            >
              <option value="track">Track Name (any artist)</option>
              <option value="artist">Artist Name (any track)</option>
              <option value="track_artist">Track + Artist (exact)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Match Mode</label>
            <select
              value={editMatchMode}
              onChange={(e) => setEditMatchMode((e.target as HTMLSelectElement).value as LastFmMatchMode)}
            >
              <option value="exact">Exact (case-insensitive)</option>
              <option value="contains">Contains (substring)</option>
            </select>
          </div>
        </div>

        {needsTrack(editMatchType) && (
          <div class="form-field">
            <label>Track Name</label>
            <input
              type="text"
              value={editTrackName}
              onInput={(e) => setEditTrackName((e.target as HTMLInputElement).value)}
            />
          </div>
        )}

        {needsArtist(editMatchType) && (
          <div class="form-field">
            <label>Artists</label>
            {editArtistNames.length > 0 && (
              <div class="artist-names-list">
                {editArtistNames.map((name, idx) => (
                  <span class="artist-name-chip" key={name}>
                    {name}
                    <button
                      type="button"
                      class="remove-artist-button"
                      onClick={() => setEditArtistNames(editArtistNames.filter((_, i) => i !== idx))}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div class="artist-input-row">
              <input
                type="text"
                value={editArtistNames.length > 0 ? editNewArtistInput : editArtistName}
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value
                  if (editArtistNames.length > 0) {
                    setEditNewArtistInput(val)
                  } else {
                    setEditArtistName(val)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editArtistNames.length > 0) {
                    e.preventDefault()
                    handleEditAddArtist()
                  }
                }}
                placeholder={editArtistNames.length > 0 ? 'Add another artist...' : 'Artist name'}
              />
              <button
                type="button"
                class="add-artist-button"
                onClick={() => {
                  if (editArtistNames.length === 0 && editArtistName.trim()) {
                    setEditArtistNames([editArtistName.trim()])
                    setEditArtistName('')
                  } else {
                    handleEditAddArtist()
                  }
                }}
              >
                +
              </button>
            </div>
          </div>
        )}

        <div class="form-field">
          <label>Session merge gap (minutes)</label>
          <input
            type="number"
            min="1"
            step="1"
            value={editMergeGapMinutes}
            onInput={(e) => setEditMergeGapMinutes((e.target as HTMLInputElement).value)}
            placeholder="Leave empty for one tag per scrobble"
          />
        </div>
      </div>

      <div class="rule-edit-actions">
        <button
          type="button"
          class="connect-button"
          onClick={() => updateMutation.mutate()}
          disabled={!canSave || updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
        <button type="button" class="cancel-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {updateMutation.isError && <p class="rule-edit-error">{getErrorMessage(updateMutation.error)}</p>}
    </div>
  )
}

function EditableRuleRow({
  rule,
  onDeleted,
  onUpdated,
}: {
  rule: LastFmTagRule
  onDeleted: () => void
  onUpdated: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Delete rule "${rule.rule_name}"?`)) return
    try {
      await deleteLastFmTagRule(rule.id)
      onDeleted()
    } catch {
      // Error will be visible via the parent's status
    }
  }

  if (isEditing) {
    return (
      <RuleEditForm
        rule={rule}
        onSaved={() => {
          setIsEditing(false)
          onUpdated()
        }}
        onCancel={() => setIsEditing(false)}
      />
    )
  }

  return (
    <div class="rule-item" key={rule.id}>
      <div class="rule-info">
        <span class="rule-name">{rule.rule_name}</span>
        <span class="rule-details">
          {formatRuleDescription(rule)}
          {' → '}
          <strong>{rule.tag_name}</strong>
          {rule.merge_gap_seconds && (
            <span class="rule-merge-info">
              {' '}
              (session merge: {Math.round(rule.merge_gap_seconds / 60)}min)
            </span>
          )}
        </span>
      </div>
      <div class="rule-actions">
        <button type="button" class="edit-rule-button" onClick={() => setIsEditing(true)}>
          Edit
        </button>
        <button type="button" class="remove-rule-button" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

export function LastFmTagRulesSettings() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const { data: rules, isLoading } = useQuery({
    enabled: !!isLoggedIn && !!userSettings?.lastfm_username,
    queryFn: fetchLastFmTagRules,
    queryKey: ['lastfmTagRules'],
  })

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const invalidateRules = () => queryClient.invalidateQueries({ queryKey: ['lastfmTagRules'] })

  // Don't show if Last.fm is not configured
  if (!userSettings?.lastfm_username) {
    return null
  }

  const rulesList = rules ?? []

  return (
    <section class="settings-section lastfm-rules-section">
      <div class="section-header-row">
        <h2>Last.fm Auto-Tagging Rules</h2>
        <SaveIndicator saveStatus={saveStatus} />
      </div>
      <p class="section-description">
        Create rules to automatically tag your listening sessions. When a scrobble matches a rule, a tag will
        be created at the scrobble time.
      </p>

      {isLoading ? (
        <p class="loading">Loading rules...</p>
      ) : (
        <>
          {/* Existing rules */}
          {rulesList.length > 0 && (
            <div class="rules-list">
              {rulesList.map((rule) => (
                <EditableRuleRow
                  key={rule.id}
                  rule={rule}
                  onDeleted={invalidateRules}
                  onUpdated={invalidateRules}
                />
              ))}
            </div>
          )}

          {/* Add new rule form */}
          <AddRuleForm onRuleAdded={invalidateRules} setSaveStatus={setSaveStatus} />
        </>
      )}
    </section>
  )
}
