import type { ComponentChildren } from 'preact'

import type { SaveStatus } from './SaveStatusIndicator'

import { SaveStatusIndicator } from './SaveStatusIndicator'
import './SaveCancelRow.css'

interface SaveCancelRowProps {
  onSave: () => void
  onCancel: () => void
  isPending?: boolean
  saveLabel?: string
  savingLabel?: string
  saveStatus?: SaveStatus
  saveStatusVariant?: 'compact' | 'text'
  children?: ComponentChildren
}

export function SaveCancelRow({
  onSave,
  onCancel,
  isPending,
  saveLabel = 'Save',
  savingLabel = 'Saving...',
  saveStatus,
  saveStatusVariant,
  children,
}: SaveCancelRowProps) {
  return (
    <div class="save-cancel-row">
      <button class="btn-primary" disabled={isPending} onClick={onSave}>
        {isPending ? savingLabel : saveLabel}
      </button>
      <button class="btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      {saveStatus && <SaveStatusIndicator state={saveStatus} variant={saveStatusVariant} />}
      {children}
    </div>
  )
}
