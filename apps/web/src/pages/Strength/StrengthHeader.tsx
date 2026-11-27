import { useLocation } from 'preact-iso'

import { useUnfinishedSession } from './queries'
import { StrengthTabs } from './StrengthTabs'
import { strengthTabForPath } from './tabsModel'
import { continueUrl } from './UnfinishedCard'

const SessionAction = () => {
  const { unfinished } = useUnfinishedSession()
  if (!unfinished) {
    return (
      <a class="btn-primary strength-header-action" href="/strength/workouts">
        Start a session
      </a>
    )
  }
  return (
    <a class="btn-primary strength-header-action" href={continueUrl(unfinished)}>
      Continue session
    </a>
  )
}

export const StrengthHeader = () => {
  const { url } = useLocation()
  const onWorkouts = strengthTabForPath(url) === 'workouts'
  return (
    <>
      <div class="strength-header">
        <h1>Strength</h1>
        {!onWorkouts && <SessionAction />}
      </div>
      <StrengthTabs />
    </>
  )
}
