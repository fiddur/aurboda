import type { DataFieldDefinition } from '@aurboda/api-spec'

import { fieldLabel } from './sessionView'

/** The field to group a type's sessions by (its categorical fields and Place), or '' for none. */
export const SessionGroupPicker = ({
  fields,
  value,
  onChange,
  noneLabel,
  ariaLabel,
}: {
  fields: DataFieldDefinition[]
  value: string
  onChange: (value: string) => void
  noneLabel: string
  ariaLabel?: string
}) => (
  <select
    aria-label={ariaLabel}
    value={value}
    onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
  >
    {fields.map((f) => (
      <option key={f.name} value={f.name}>
        By {fieldLabel(f).toLowerCase()}
      </option>
    ))}
    {value && !fields.some((f) => f.name === value) && <option value={value}>By {value}</option>}
    <option value="">{noneLabel}</option>
  </select>
)
