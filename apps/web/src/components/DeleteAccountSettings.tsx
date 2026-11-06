import { useLocation } from 'preact-iso'

import { deleteMyAccount } from '../state/api'
import { auth, logout } from '../state/auth'
import { DeleteAccountConfirm } from './DeleteAccountConfirm'
import { SettingsSection } from './SettingsSection'

export function DeleteAccountSettings() {
  const { route } = useLocation()
  const username = auth.value.user ?? ''

  return (
    <SettingsSection title="Delete account">
      <p class="section-description">
        Deleting your account removes all of your data from this server for good: every metric, activity,
        location and setting, your integration connections, and your public profile and posts. Servers that
        follow you are told the account is gone, and the username <strong>{username}</strong> can never be
        used again. Download an export above first if you want to keep a copy.
      </p>
      {username ? (
        <DeleteAccountConfirm
          username={username}
          label="Delete account"
          onDelete={() => deleteMyAccount({ confirm_username: username })}
          onDeleted={() => {
            logout()
            route('/')
          }}
        />
      ) : (
        <p class="field-description">Log in again to delete your account.</p>
      )}
    </SettingsSection>
  )
}
