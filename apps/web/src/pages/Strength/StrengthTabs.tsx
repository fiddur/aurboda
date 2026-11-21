import { useLocation } from 'preact-iso'

import { STRENGTH_TABS, strengthTabForPath } from './tabsModel'

export const StrengthTabs = () => {
  const { url } = useLocation()
  const active = strengthTabForPath(url)
  return (
    <nav class="strength-tabs" aria-label="Strength">
      {STRENGTH_TABS.map((t) => (
        <a key={t.id} href={t.href} class="strength-tab" aria-current={t.id === active ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  )
}
