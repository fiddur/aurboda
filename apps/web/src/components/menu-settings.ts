import { isPageHidden, type MenuSwitch, menuSwitches } from './nav-links'

export interface MenuSettingsGroup {
  id: string
  label: string
  switches: (MenuSwitch & { shown: boolean })[]
}

export interface MenuSettingsView {
  groups: MenuSettingsGroup[]
  hiddenCount: number
}

/** What the Settings → Menu section shows for a hidden list: each switch's state, and how many are off. */
export const menuSettingsView = (hidden: readonly string[]): MenuSettingsView => {
  const groups = menuSwitches().map((group) => ({
    ...group,
    switches: group.switches.map((s) => ({ ...s, shown: !isPageHidden(s.path, hidden) })),
  }))
  const hiddenCount = groups.flatMap((g) => g.switches).filter((s) => !s.shown).length
  return { groups, hiddenCount }
}
