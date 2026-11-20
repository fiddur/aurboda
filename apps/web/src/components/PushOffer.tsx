import { useState } from 'preact/hooks'

import { PUSH_OFFER_DISMISSED_KEY, shouldOfferPush } from './push'
import { usePush } from './usePush'

const readDismissed = (): boolean => {
  try {
    return localStorage.getItem(PUSH_OFFER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

const storeDismissed = (): void => {
  try {
    localStorage.setItem(PUSH_OFFER_DISMISSED_KEY, '1')
  } catch {
    // Without storage the offer simply comes back next time.
  }
}

/** The bell's one-time offer to turn on push in this browser. */
export function PushOffer() {
  const push = usePush()
  const [dismissed, setDismissed] = useState(readDismissed)
  if (!shouldOfferPush(push.state, dismissed)) return null

  const dismiss = () => {
    storeDismissed()
    setDismissed(true)
  }

  return (
    <div class="push-offer" role="region" aria-label="Push notifications">
      {push.state === 'needs_home_screen' ? (
        <p>
          To get notifications on this device, add Aurboda to the home screen first (Share, then Add to Home
          Screen) and turn push on from there.
        </p>
      ) : (
        <p>Get these as system notifications in this browser, even with no Aurboda tab open?</p>
      )}
      {push.error && <p class="error">{push.error}</p>}
      <div class="push-offer-actions">
        {push.state === 'off' && (
          <button type="button" class="btn-primary" disabled={push.busy} onClick={push.enable}>
            Turn on
          </button>
        )}
        <button type="button" class="btn-secondary" onClick={dismiss}>
          {push.state === 'off' ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  )
}
