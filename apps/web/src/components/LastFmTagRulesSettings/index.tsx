import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import {
  createLastFmTagRule,
  deleteLastFmTagRule,
  fetchLastFmTagRules,
  fetchUserSettings,
  type AddLastFmTagRuleBody,
  type LastFmMatchMode,
  type LastFmMatchType,
  type LastFmTagRule,
} from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; time?: Date; error?: string }

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
  const [matchMode, setMatchMode] = useState<LastFmMatchMode>('exact')
  const [tagName, setTagName] = useState('')

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const handleAddRule = async () => {
    if (!ruleName.trim() || !tagName.trim()) return

    // Validate required fields based on match type
    if ((matchType === 'track' || matchType === 'track_artist') && !trackName.trim()) {
      setSaveStatus({ error: 'Track name is required', status: 'error' })
      return
    }
    if ((matchType === 'artist' || matchType === 'track_artist') && !artistName.trim()) {
      setSaveStatus({ error: 'Artist name is required', status: 'error' })
      return
    }

    setSaveStatus({ status: 'saving' })
    try {
      const rule: AddLastFmTagRuleBody = {
        matchMode,
        matchType,
        ruleName: ruleName.trim(),
        tagName: tagName.trim(),
      }
      if (matchType === 'track' || matchType === 'track_artist') {
        rule.trackName = trackName.trim()
      }
      if (matchType === 'artist' || matchType === 'track_artist') {
        rule.artistName = artistName.trim()
      }

      await createLastFmTagRule(rule)
      queryClient.invalidateQueries({ queryKey: ['lastfmTagRules'] })

      // Reset form
      setRuleName('')
      setTrackName('')
      setArtistName('')
      setTagName('')
      setSaveStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to create rule',
        status: 'error',
      })
    }
  }

  const handleDeleteRule = async (rule: LastFmTagRule) => {
    if (!confirm(`Delete rule "${rule.ruleName}"?`)) return

    try {
      await deleteLastFmTagRule(rule.id)
      queryClient.invalidateQueries({ queryKey: ['lastfmTagRules'] })
    } catch (err) {
      setSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to delete rule',
        status: 'error',
      })
    }
  }

  // Don't show if Last.fm is not configured
  if (!userSettings?.lastfm_username) {
    return null
  }

  return (
    <section class="settings-section lastfm-rules-section">
      <div class="section-header-row">
        <h2>Last.fm Auto-Tagging Rules</h2>
        {saveStatus.status !== 'idle' && (
          <span class={`save-indicator ${saveStatus.status}`}>
            {saveStatus.status === 'saving' && 'Saving...'}
            {saveStatus.status === 'saved' && 'Rule created'}
            {saveStatus.status === 'error' && (saveStatus.error ?? 'Error')}
          </span>
        )}
      </div>
      <p class="section-description">
        Create rules to automatically tag your listening sessions. When a scrobble matches a rule, a tag will
        be created at the scrobble time.
      </p>

      {isLoading ?
        <p class="loading">Loading rules...</p>
      : <>
          {/* Existing rules */}
          {(rules ?? []).length > 0 && (
            <div class="rules-list">
              {(rules ?? []).map((rule) => (
                <div class="rule-item" key={rule.id}>
                  <div class="rule-info">
                    <span class="rule-name">{rule.ruleName}</span>
                    <span class="rule-details">
                      {rule.matchType === 'track' && `Track: "${rule.trackName}"`}
                      {rule.matchType === 'artist' && `Artist: "${rule.artistName}"`}
                      {rule.matchType === 'track_artist' && `"${rule.trackName}" by "${rule.artistName}"`}
                      {rule.matchMode === 'contains' && ' (contains)'}
                      {' → '}
                      <strong>{rule.tagName}</strong>
                    </span>
                  </div>
                  <button type="button" class="remove-rule-button" onClick={() => handleDeleteRule(rule)}>
                    Delete
                  </button>
                </div>
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

            {(matchType === 'track' || matchType === 'track_artist') && (
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

            {(matchType === 'artist' || matchType === 'track_artist') && (
              <div class="form-field">
                <label for="artist-name">Artist Name</label>
                <input
                  id="artist-name"
                  type="text"
                  value={artistName}
                  onInput={(e) => setArtistName((e.target as HTMLInputElement).value)}
                  placeholder="e.g., Meditation Artist"
                />
              </div>
            )}

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
