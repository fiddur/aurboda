/**
 * Form for adding a new Last.fm auto-tagging rule.
 */
import { useState } from 'preact/hooks'

import {
  createLastFmTagRule,
  type AddLastFmTagRuleBody,
  type LastFmMatchMode,
  type LastFmMatchType,
} from '../../state/api'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; time?: Date; error?: string }

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Failed to save')

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

const buildRule = (
  base: Pick<AddLastFmTagRuleBody, 'match_mode' | 'match_type' | 'rule_name' | 'tag_name'>,
  opts: { trackName: string; artistName: string; artistNames: string[]; mergeGapMinutes: string },
): AddLastFmTagRuleBody => {
  const rule: AddLastFmTagRuleBody = { ...base }
  if (needsTrack(base.match_type)) rule.track_name = opts.trackName.trim()
  if (needsArtist(base.match_type)) {
    if (opts.artistNames.length > 0) {
      rule.artist_names = opts.artistNames
    } else {
      rule.artist_name = opts.artistName.trim()
    }
  }
  const gapMinutes = parseFloat(opts.mergeGapMinutes)
  if (gapMinutes > 0) rule.merge_gap_seconds = Math.round(gapMinutes * 60)
  return rule
}

export function AddRuleForm({
  onRuleAdded,
  setSaveStatus,
}: {
  onRuleAdded: () => void
  setSaveStatus: (s: SaveStatus) => void
}) {
  const [ruleName, setRuleName] = useState('')
  const [matchType, setMatchType] = useState<LastFmMatchType>('track')
  const [trackName, setTrackName] = useState('')
  const [artistName, setArtistName] = useState('')
  const [artistNames, setArtistNames] = useState<string[]>([])
  const [newArtistInput, setNewArtistInput] = useState('')
  const [matchMode, setMatchMode] = useState<LastFmMatchMode>('exact')
  const [tagName, setTagName] = useState('')
  const [mergeGapMinutes, setMergeGapMinutes] = useState('')

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
      onRuleAdded()

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

  return (
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
                  <button type="button" class="remove-artist-button" onClick={() => handleRemoveArtist(idx)}>
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
                if (artistNames.length > 0) setNewArtistInput(val)
                else setArtistName(val)
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
          <p class="field-help">Add multiple artists to match any of them. Use + button or Enter to add.</p>
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
          When set, consecutive matching scrobbles within this gap are grouped into a single span tag. Leave
          empty for one tag per scrobble. The gap should account for track length + pause between tracks.
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
  )
}
