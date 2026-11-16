import type { OidcLink } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { isEmbedded } from '../embed'
import { apiErrorMessage, fetchOidcLinks, fetchOidcProviders, startOidcLink, unlinkOidc } from '../state/api'
import { isLastLoginMethod, oidcErrorMessage, unlinkedProviders } from '../utils/oidc'
import { OidcButtons } from './OidcButtons'
import { SettingsSection } from './SettingsSection'
import './LinkedProvidersSettings.css'

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'

function LinkList({
  links,
  lastMethod,
  busy,
  onUnlink,
}: {
  links: OidcLink[]
  lastMethod: boolean
  busy: boolean
  onUnlink: (id: string, name: string) => void
}) {
  if (links.length === 0) return <p class="no-data">No provider linked yet.</p>
  return (
    <>
      <ul class="linked-providers-list">
        {links.map((link) => (
          <li key={link.id}>
            <span>
              <span class="linked-provider-name">{link.provider_display_name}</span>
              <span class="linked-provider-meta">
                {link.email ? `${link.email} · ` : ''}last used {formatDate(link.last_login_at)}
              </span>
            </span>
            <button
              type="button"
              disabled={lastMethod || busy}
              title={lastMethod ? 'This is your only way to log in' : undefined}
              onClick={() => onUnlink(link.id, link.provider_display_name)}
            >
              Unlink
            </button>
          </li>
        ))}
      </ul>
      {lastMethod && (
        <p class="unlink-blocked">
          This is your only way to log in: add a passkey or link another provider before unlinking it.
        </p>
      )}
    </>
  )
}

/**
 * The account's linked single sign-on identities: unlink one (never the last way to log in) and link
 * the enabled providers not linked yet. Absent when the server has no providers and nothing is linked.
 * Embedded in the app there is no Link button: the provider's page opens in the system browser,
 * which has neither the session nor the verifier to complete the link.
 */
export function LinkedProvidersSettings({
  linked = false,
  linkError,
}: {
  linked?: boolean
  linkError?: string
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(oidcErrorMessage(linkError))

  useEffect(() => {
    if (linked || linkError) document.getElementById('sign-in-providers')?.scrollIntoView({ block: 'start' })
  }, [linked, linkError])

  const { data: providers = [] } = useQuery({ queryFn: fetchOidcProviders, queryKey: ['oidcProviders'] })
  const { data, isLoading } = useQuery({ queryFn: fetchOidcLinks, queryKey: ['oidcLinks'] })

  const unlinkMut = useMutation({
    mutationFn: (id: string) => unlinkOidc(id),
    onError: (err) => setError(apiErrorMessage(err, 'The provider could not be unlinked')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['oidcLinks'] })
      void queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    },
  })

  const links = data?.links ?? []
  if (!isLoading && providers.length === 0 && links.length === 0) return null

  const lastMethod = isLastLoginMethod(data?.login_methods ?? 0)
  const linkable = unlinkedProviders(providers, links)

  const onUnlink = (id: string, name: string) => {
    setError(null)
    if (window.confirm(`Unlink ${name}? You will not be able to log in with it anymore.`)) {
      unlinkMut.mutate(id)
    }
  }

  return (
    <SettingsSection
      id="sign-in-providers"
      class="linked-providers-settings"
      title="Linked sign-in providers"
      description="Log in with an account you already have elsewhere. A linked provider is one more way in, next to your password and passkeys."
      isLoading={isLoading}
    >
      {linked && !error && <p class="recovery-prompt">The provider is linked. You can now log in with it.</p>}

      <LinkList links={links} lastMethod={lastMethod} busy={unlinkMut.isPending} onUnlink={onUnlink} />

      {error && <p class="error">{error}</p>}

      {isEmbedded() ? (
        linkable.length > 0 && (
          <p class="link-in-browser">
            To link a sign-in provider, open Aurboda in a browser and go to Settings.
          </p>
        )
      ) : (
        <OidcButtons className="oidc-buttons" providers={linkable} start={startOidcLink} verb="Link" />
      )}
    </SettingsSection>
  )
}
