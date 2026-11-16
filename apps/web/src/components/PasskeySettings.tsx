import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { apiErrorMessage } from '../state/api'
import { deletePasskey, listPasskeys, registerPasskey, renamePasskey } from '../state/api/webauthn'
import { SettingsSection } from './SettingsSection'

const formatDate = (iso: string | null): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

/** `recovered`: the user just signed in with a recovery link to add a new passkey. */
export function PasskeySettings({ recovered = false }: { recovered?: boolean }) {
  const queryClient = useQueryClient()
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  useEffect(() => {
    if (recovered) document.getElementById('passkeys')?.scrollIntoView({ block: 'start' })
  }, [recovered])

  const { data: passkeys, isLoading } = useQuery({
    queryFn: listPasskeys,
    queryKey: ['passkeys'],
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePasskey(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePasskey(id),
    onError: (err) => setError(apiErrorMessage(err, 'The passkey could not be deleted')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      void queryClient.invalidateQueries({ queryKey: ['oidcLinks'] })
    },
  })

  const onRegister = async () => {
    setError(null)
    setRegistering(true)
    const result = await registerPasskey(nickname || undefined)
    setRegistering(false)
    if (!result.verified) {
      setError(result.error ?? 'Registration failed')
      return
    }
    setNickname('')
    queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    queryClient.invalidateQueries({ queryKey: ['oidcLinks'] })
  }

  const onRename = (id: string, current: string | null) => {
    const next = window.prompt('Rename passkey', current ?? '')
    if (next !== null && next !== current) {
      renameMut.mutate({ id, name: next })
    }
  }

  const onDelete = (id: string) => {
    if (window.confirm('Delete this passkey? You will not be able to use it to sign in anymore.')) {
      setError(null)
      deleteMut.mutate(id)
    }
  }

  return (
    <SettingsSection
      id="passkeys"
      title="Passkeys"
      description="Register a passkey to sign in without a password. Passkeys created here can also be used from the Aurboda Android app on the same device or via cross-device QR sync."
    >
      {recovered && (
        <p class="recovery-prompt">
          You signed in with a recovery link. Add a new passkey now, and delete any you have lost.
        </p>
      )}

      <div class="form-field">
        <label for="passkey-nickname">Nickname (optional)</label>
        <input
          id="passkey-nickname"
          type="text"
          maxLength={64}
          placeholder="e.g. Work laptop"
          value={nickname}
          onInput={(e) => setNickname((e.target as HTMLInputElement).value)}
        />
      </div>

      <button type="button" class="primary" disabled={registering} onClick={onRegister}>
        {registering ? 'Waiting for authenticator…' : 'Add a passkey'}
      </button>

      {error && <p class="error">{error}</p>}

      {isLoading ? (
        <p class="loading">Loading…</p>
      ) : passkeys && passkeys.length > 0 ? (
        <table class="passkeys-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Created</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {passkeys.map((p) => (
              <tr key={p.credential_id}>
                <td>{p.nickname ?? <em>unnamed</em>}</td>
                <td>{p.device_type ?? '—'}</td>
                <td>{formatDate(p.created_at)}</td>
                <td>{formatDate(p.last_used_at)}</td>
                <td>
                  <button type="button" onClick={() => onRename(p.credential_id, p.nickname)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => onDelete(p.credential_id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="no-data">No passkeys yet.</p>
      )}
    </SettingsSection>
  )
}
