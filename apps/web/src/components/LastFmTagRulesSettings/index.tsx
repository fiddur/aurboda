import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import {
  createLastFmTagRule,
  deleteLastFmTagRule,
  fetchLastFmTagRules,
  fetchUserSettings,
  updateLastFmTagRule,
  type AddLastFmTagRuleBody,
  type LastFmMatchMode,
  type LastFmMatchType,
  type LastFmTagRule,
  type UpdateLastFmTagRuleBody,
} from '../../state/api'
import { auth } from '../../state/auth'

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
  if (needsArtist(matchType) && !artistNames.length && !artistName.trim())
    return 'At least one artist name is required'
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

const buildRule = (
  base: Pick<AddLastFmTagRuleBody, 'match_mode' | 'match_type' | 'rule_name' | 'tag_name'>,
  opts: { trackName: string; artistName: string; artistNames: string[]; mergeGapMinutes: string },
): AddLastFmTagRuleBody => {
  const rule: AddLastFmTagRuleBody = { ...base }
  if (needsTrack(base.match_type)) {
    rule.track_name = opts.trackName.trim()
  }
  if (needsArtist(base.match_type)) {
    if (opts.artistNames.length > 0) {
      rule.artist_names = opts.artistNames
    } else {
      rule.artist_name = opts.artistName.trim()
    }
  }
  const gapMinutes = parseFloat(opts.mergeGapMinutes)
  if (gapMinutes > 0) {
    rule.merge_gap_seconds = Math.round(gapMinutes * 60)
  }
  return rule
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

  const resetForm = () => {
    setEditRuleName(rule.rule_name)
    setEditTagName(rule.tag_name)
    setEditMatchType(rule.match_type)
    setEditMatchMode(rule.match_mode)
    setEditTrackName(rule.track_name ?? '')
    setEditArtistName(rule.artist_name ?? '')
    setEditArtistNames(rule.artist_names ?? [])
    setEditNewArtistInput('')
    setEditMergeGapMinutes(rule.merge_gap_seconds ? String(Math.round(rule.merge_gap_seconds / 60)) : '')
  }

  const handleEditAddArtist = () => {
    const name = editNewArtistInput.trim()
    if (name && !editArtistNames.includes(name)) {
      setEditArtistNames([...editArtistNames, name])
      setEditNewArtistInput('')
    }
  }

  const updateMutation = useMutation({
    mutationFn: () => {
      const body: UpdateLastFmTagRuleBody = {}

      if (editRuleName.trim() !== rule.rule_name) body.rule_name = editRuleName.trim()
      if (editTagName.trim() !== rule.tag_name) body.tag_name = editTagName.trim()
      if (editMatchType !== rule.match_type) body.match_type = editMatchType
      if (editMatchMode !== rule.match_mode) body.match_mode = editMatchMode

      if (needsTrack(editMatchType)) {
        if (editTrackName.trim() !== (rule.track_name ?? '')) body.track_name = editTrackName.trim()
      }
      if (needsArtist(editMatchType)) {
        if (editArtistNames.length > 0) {
          const original = rule.artist_names ?? []
          if (
            editArtistNames.length !== original.length ||
            editArtistNames.some((n, i) => n !== original[i])
          ) {
            body.artist_names = editArtistNames
          }
        } else if (editArtistName.trim() !== (rule.artist_name ?? '')) {
          body.artist_name = editArtistName.trim()
        }
      }

      const gapMinutes = parseFloat(editMergeGapMinutes)
      const newGapSeconds = gapMinutes > 0 ? Math.round(gapMinutes * 60) : null
      if (newGapSeconds !== (rule.merge_gap_seconds ?? null)) {
        body.merge_gap_seconds = newGapSeconds
      }

      return updateLastFmTagRule(rule.id, body)
    },
    onSuccess: () => {
      setIsEditing(false)
      onUpdated()
    },
  })

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
          <button
            type="button"
            class="cancel-button"
            onClick={() => {
              resetForm()
              setIsEditing(false)
            }}
          >
            Cancel
          </button>
        </div>
        {updateMutation.isError && <p class="rule-edit-error">{getErrorMessage(updateMutation.error)}</p>}
      </div>
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
        <button
          type="button"
          class="edit-rule-button"
          onClick={() => {
            resetForm()
            setIsEditing(true)
          }}
        >
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

  // Form state for new rule
  const [ruleName, setRuleName] = useState('')
  const [matchType, setMatchType] = useState<LastFmMatchType>('track')
  const [trackName, setTrackName] = useState('')
  const [artistName, setArtistName] = useState('')
  const [artistNames, setArtistNames] = useState<string[]>([])
  const [newArtistInput, setNewArtistInput] = useState('')
  const [matchMode, setMatchMode] = useState<LastFmMatchMode>('exact')
  const [tagName, setTagName] = useState('')
  const [mergeGapMinutes, setMergeGapMinutes] = useState('')

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const handleAddArtist = () => {
    const name = newArtistInput.trim()
    if (name && !artistNames.includes(name)) {
      setArtistNames([...artistNames, name])
      setNewArtistInput('')
    }
  }

  const handleRemoveArtist = (index: number) => {
    setArtistNames(artistNames.filter((_, i) => i !== index))
  }

  const handleAddRule = async () => {
    if (!ruleName.trim() || !tagName.trim()) return

    const validationError = validateRuleForm(matchType, trackName, artistName, artistNames)
    if (validationError) {
      setSaveStatus({ error: validationError, status: 'error' })
      return
    }

    setSaveStatus({ status: 'saving' })
    try {
      const rule = buildRule(
        {
          match_mode: matchMode,
          match_type: matchType,
          rule_name: ruleName.trim(),
          tag_name: tagName.trim(),
        },
        { artistName, artistNames, mergeGapMinutes, trackName },
      )

      await createLastFmTagRule(rule)
      queryClient.invalidateQueries({ queryKey: ['lastfmTagRules'] })

      // Reset form
      setRuleName('')
      setTrackName('')
      setArtistName('')
      setArtistNames([])
      setNewArtistInput('')
      setTagName('')
      setMergeGapMinutes('')
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({ error: getErrorMessage(err), status: 'error' })
    }
  }

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

      {isLoading ?
        <p class="loading">Loading rules...</p>
      : <>
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
          <div class="add-rule-form">
            <h3>Add New Rule</h3>

            <div class="form-row">
              <div class="form-field">
                <label for="rule-name">Rule Name</label>
                <input
                  id="rule-name"
                  type="text"
                  value={ruleName}
                  onInput={(e) => setRuleName((e.target as HTMLInputElement).value)}
                  placeholder="e.g., Vocal Exercises"
                />
              </div>

              <div class="form-field">
                <label for="tag-name">Tag to Create</label>
                <input
                  id="tag-name"
                  type="text"
                  value={tagName}
                  onInput={(e) => setTagName((e.target as HTMLInputElement).value)}
                  placeholder="e.g., VocalExercises"
                />
              </div>
            </div>

            <div class="form-row">
              <div class="form-field">
                <label for="match-type">Match Type</label>
                <select
                  id="match-type"
                  value={matchType}
                  onChange={(e) => setMatchType((e.target as HTMLSelectElement).value as LastFmMatchType)}
                >
                  <option value="track">Track Name (any artist)</option>
                  <option value="artist">Artist Name (any track)</option>
                  <option value="track_artist">Track + Artist (exact)</option>
                </select>
              </div>

              <div class="form-field">
                <label for="match-mode">Match Mode</label>
                <select
                  id="match-mode"
                  value={matchMode}
                  onChange={(e) => setMatchMode((e.target as HTMLSelectElement).value as LastFmMatchMode)}
                >
                  <option value="exact">Exact (case-insensitive)</option>
                  <option value="contains">Contains (substring)</option>
                </select>
              </div>
            </div>

            {needsTrack(matchType) && (
              <div class="form-field">
                <label for="track-name">Track Name</label>
                <input
                  id="track-name"
                  type="text"
                  value={trackName}
                  onInput={(e) => setTrackName((e.target as HTMLInputElement).value)}
                  placeholder="e.g., Warmup Track 1"
                />
              </div>
            )}

            {needsArtist(matchType) && (
              <div class="form-field">
                <label>Artists</label>
                {artistNames.length > 0 && (
                  <div class="artist-names-list">
                    {artistNames.map((name, idx) => (
                      <span class="artist-name-chip" key={name}>
                        {name}
                        <button
                          type="button"
                          class="remove-artist-button"
                          onClick={() => handleRemoveArtist(idx)}
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
                    value={artistNames.length > 0 ? newArtistInput : artistName}
                    onInput={(e) => {
                      const val = (e.target as HTMLInputElement).value
                      if (artistNames.length > 0) {
                        setNewArtistInput(val)
                      } else {
                        setArtistName(val)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && artistNames.length > 0) {
                        e.preventDefault()
                        handleAddArtist()
                      }
                    }}
                    placeholder={artistNames.length > 0 ? 'Add another artist...' : 'e.g., Meditation Artist'}
                  />
                  <button
                    type="button"
                    class="add-artist-button"
                    onClick={() => {
                      if (artistNames.length === 0 && artistName.trim()) {
                        setArtistNames([artistName.trim()])
                        setArtistName('')
                      } else {
                        handleAddArtist()
                      }
                    }}
                  >
                    +
                  </button>
                </div>
                <p class="field-help">
                  Add multiple artists to match any of them. Use + button or Enter to add.
                </p>
              </div>
            )}

            <div class="form-field">
              <label for="merge-gap">Session merge gap (minutes)</label>
              <input
                id="merge-gap"
                type="number"
                min="1"
                step="1"
                value={mergeGapMinutes}
                onInput={(e) => setMergeGapMinutes((e.target as HTMLInputElement).value)}
                placeholder="e.g., 10"
              />
              <p class="field-help">
                When set, consecutive matching scrobbles within this gap are grouped into a single span tag.
                Leave empty for one tag per scrobble. The gap should account for track length + pause between
                tracks.
              </p>
            </div>

            <button
              type="button"
              class="connect-button"
              onClick={handleAddRule}
              disabled={!ruleName.trim() || !tagName.trim()}
            >
              Add Rule
            </button>
          </div>
        </>
      }
    </section>
  )
}
