import type { ItemValueIdentityState } from '@aurboda/api-spec'

export type IdentityActionKind = 'pick' | 'dismiss' | 'clear'

export interface IdentityAction {
  kind: IdentityActionKind
  label: string
}

export interface IdentityView {
  line: string
  showsEntry: boolean
  pickerInitiallyOpen: boolean
  actions: IdentityAction[]
}

const VIEWS: Record<ItemValueIdentityState, IdentityView> = {
  catalog: {
    actions: [
      { kind: 'pick', label: 'Change' },
      { kind: 'dismiss', label: 'Not this exercise' },
    ],
    line: 'Matched to the catalogue by name',
    pickerInitiallyOpen: false,
    showsEntry: true,
  },
  dismissed: {
    actions: [{ kind: 'clear', label: 'Undo' }],
    line: 'Marked as not in the catalogue',
    pickerInitiallyOpen: false,
    showsEntry: false,
  },
  unmapped: {
    actions: [
      { kind: 'pick', label: 'Find in the catalogue' },
      { kind: 'dismiss', label: 'Not in the catalogue' },
    ],
    line: 'Not matched to the built-in catalogue',
    pickerInitiallyOpen: true,
    showsEntry: false,
  },
  user: {
    actions: [
      { kind: 'pick', label: 'Change' },
      { kind: 'clear', label: 'Remove mapping' },
    ],
    line: 'Mapped by you',
    pickerInitiallyOpen: false,
    showsEntry: true,
  },
}

export const identityView = (state: ItemValueIdentityState): IdentityView => VIEWS[state]

export const MERGE_HINT = 'Use “Merge into…” above to combine their history.'

export const otherValuesHint = (otherCount: number, showsMerge: boolean): string | undefined =>
  otherCount > 0 && showsMerge ? MERGE_HINT : undefined
