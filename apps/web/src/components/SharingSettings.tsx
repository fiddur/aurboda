import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import type { UpdateSettingsInput } from '../state/api'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { formatTagsInput, invalidTagTokens, parseTagsInput } from './hashtags'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'

/** The automatic hashtags of the user's feed posts. */
export function SharingSettings() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    enabled: !!auth.value.token,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const [defaultTags, setDefaultTags] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const save = useMutation({
    mutationFn: (params: UpdateSettingsInput) => updateUserSettings(params),
    onError: (err) =>
      setSaveStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' }),
    onMutate: () => setSaveStatus({ status: 'saving' }),
    onSuccess: (result) => {
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved', time: new Date() })
    },
  })

  if (!settings) return null
  const storedTags = settings.feed_default_tags ?? []
  const tagsText = defaultTags ?? formatTagsInput(storedTags)
  const invalid = invalidTagTokens(tagsText)

  const saveTags = () => {
    const tags = parseTagsInput(tagsText)
    if (tags.join(' ') !== storedTags.join(' ')) save.mutate({ feed_default_tags: tags })
  }

  return (
    <SettingsSection
      title="Sharing"
      description="The hashtags your feed posts get unless you choose others when sharing."
      headerExtra={<SaveStatusIndicator state={saveStatus} />}
    >
      <div class="form-field">
        <label for="feed-default-tags">Default tags</label>
        <input
          id="feed-default-tags"
          type="text"
          value={tagsText}
          placeholder="#aurboda"
          onInput={(e) => setDefaultTags((e.target as HTMLInputElement).value)}
          onBlur={saveTags}
        />
        <p class="field-description">
          Hashtags separated by spaces, added to every activity, exercise, challenge and article you share.
          Leave empty for none. #tags typed in a post are always added too.
        </p>
        {invalid.length > 0 && (
          <p class="field-description">
            Not a tag (letters, digits and _ only), left out: {invalid.join(' ')}
          </p>
        )}
      </div>
      <div class="form-field">
        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={settings.feed_type_tag ?? true}
            onChange={(e) => save.mutate({ feed_type_tag: (e.target as HTMLInputElement).checked })}
          />
          <span>Add the activity type as a tag (e.g. #running)</span>
        </label>
      </div>
    </SettingsSection>
  )
}
