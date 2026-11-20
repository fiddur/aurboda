import type { PushSubscription } from '@aurboda/api-spec'

import type { PushState } from './push'

import { usePush } from './usePush'

export const PUSH_STATE_TEXT: Record<Exclude<PushState, 'hidden' | 'loading'>, string> = {
  blocked:
    'This browser blocks notifications from Aurboda. Allow them in the site settings (the icon next to the address), then reload this page.',
  needs_home_screen:
    'On iPhone and iPad, push works only once Aurboda is added to the home screen: tap Share, then Add to Home Screen, and open it from there.',
  off: 'Show the notifications you push as system notifications here, even with no Aurboda tab open.',
  on: 'This browser shows your push notifications.',
  unsupported: 'This browser cannot receive push notifications.',
}

const formatDate = (iso: string | null): string =>
  iso === null ? 'never' : new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })

function OtherBrowsers({
  browsers,
  busy,
  onRemove,
}: {
  browsers: PushSubscription[]
  busy: boolean
  onRemove: (id: string) => void
}) {
  if (browsers.length === 0) return null
  return (
    <>
      <h5 class="push-browsers-title">Other browsers</h5>
      <ul class="push-browsers">
        {browsers.map((browser) => (
          <li key={browser.id}>
            <span>
              <span class="push-browser-name">{browser.browser}</span>
              <span class="push-browser-meta">
                Added {formatDate(browser.created_at)} · last reached {formatDate(browser.last_success_at)}
              </span>
            </span>
            <button type="button" class="btn-secondary" disabled={busy} onClick={() => onRemove(browser.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

const testResultText = ({ reached = 0, total = 0 }: { reached?: number; total?: number }): string =>
  total === 0
    ? 'No browser is subscribed.'
    : `Sent: ${reached} of ${total} browser${total === 1 ? '' : 's'} reached.`

/** Settings → Notifications: push to this browser, and the user's other subscribed browsers. */
export function PushSettings() {
  const push = usePush()
  if (push.state === 'hidden') return null

  return (
    <div class="push-settings">
      <h4 class="notification-group-title">Push in this browser</h4>
      {push.state === 'loading' ? (
        <p class="field-description">Loading…</p>
      ) : (
        <>
          <p class="field-description">{PUSH_STATE_TEXT[push.state]}</p>
          <div class="push-actions">
            {push.state === 'off' && (
              <button type="button" class="btn-primary" disabled={push.busy} onClick={push.enable}>
                Enable
              </button>
            )}
            {push.state === 'on' && (
              <button type="button" class="btn-secondary" disabled={push.busy} onClick={push.disable}>
                Disable
              </button>
            )}
            {(push.state === 'on' || push.others.length > 0) && (
              <button type="button" class="btn-secondary" disabled={push.testing} onClick={push.sendTest}>
                Send test
              </button>
            )}
          </div>
        </>
      )}
      {push.test && (
        <p class="push-test-result" role="status">
          {testResultText(push.test)}
        </p>
      )}
      {push.error && <p class="error">{push.error}</p>}
      <OtherBrowsers browsers={push.others} busy={push.removing} onRemove={push.remove} />
    </div>
  )
}
