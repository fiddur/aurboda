import { useLocation } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { musclesRedirectTarget } from './tabsModel'

export function StrengthMusclesRedirect() {
  const { route, url } = useLocation()
  useEffect(() => route(musclesRedirectTarget(url), true), [])
  return null
}
