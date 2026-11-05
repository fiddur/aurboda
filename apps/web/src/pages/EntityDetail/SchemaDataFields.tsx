import type { DataFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

import { useEffect, useRef } from 'preact/hooks'

import { KnownValuesInput } from '../../components/KnownValuesInput'
import { ListFieldEditor } from '../../components/ListFieldEditor'
import { fieldLabel, listFields, scalarFields } from '../../components/sessions/sessionView'

const offersKnownValues = (field: DataFieldDefinition) =>
  field.type === 'string' && Boolean(field.is_categorical) && !field.enum_values

const FieldInput = ({
  field,
  value,
  onChange,
  activityType,
  focus,
}: {
  field: DataFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  activityType: string
  focus: boolean
}) => {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus()
  }, [focus])

  if (field.type === 'boolean') {
    return (
      <input
        ref={ref}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
    )
  }

  if (field.type === 'string' && field.enum_values) {
    return (
      <select
        ref={ref}
        class="edit-datetime-input"
        value={(value as string) ?? ''}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}
      >
        <option value="">-- Select --</option>
        {field.enum_values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'number') {
    return (
      <span style={{ alignItems: 'center', display: 'flex', gap: '0.25rem' }}>
        <input
          ref={ref}
          type="number"
          class="edit-datetime-input"
          value={value != null ? String(value) : ''}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value
            if (raw === '') {
              onChange(null)
            } else {
              const num = parseFloat(raw)
              if (!isNaN(num)) onChange(num)
            }
          }}
        />
        {field.unit && <span style={{ opacity: 0.6 }}>{field.unit}</span>}
      </span>
    )
  }

  if (offersKnownValues(field)) {
    return (
      <KnownValuesInput
        activityType={activityType}
        field={field.name}
        class="edit-datetime-input"
        value={(value as string) ?? ''}
        onChange={(v) => onChange(v || null)}
        focus={focus}
      />
    )
  }

  return (
    <input
      ref={ref}
      type="text"
      class="edit-datetime-input"
      autoComplete="off"
      value={(value as string) ?? ''}
      onInput={(e) => onChange((e.target as HTMLInputElement).value || null)}
    />
  )
}

const asRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v),
      )
    : []

/**
 * Inputs for the type's declared data fields. Categorical text fields suggest the values already
 * used on this type, so a repeat (a session name, a run kind) is picked instead of retyped.
 */
export const SchemaDataFields = ({
  activityType,
  data,
  schema,
  onDataChange,
  focusField,
}: {
  activityType: string
  data: Record<string, unknown>
  schema: DataSchemaDefinition
  onDataChange: (data: Record<string, unknown>) => void
  focusField?: string
}) => (
  <div class="entity-fields">
    {scalarFields(schema).map((field) => (
      <div class="field-row" key={field.name}>
        <span class="field-label">{fieldLabel(field)}</span>
        <span class="field-value">
          <FieldInput
            field={field}
            value={data[field.name]}
            onChange={(value) => onDataChange({ ...data, [field.name]: value })}
            activityType={activityType}
            focus={field.name === focusField}
          />
        </span>
      </div>
    ))}
    {listFields(schema).map((field) => (
      <div class="field-row field-row-list" key={field.name}>
        <span class="field-label">{fieldLabel(field)}</span>
        <ListFieldEditor
          field={field}
          idPrefix={`edit-${field.name}`}
          rows={asRows(data[field.name])}
          onChange={(rows) => onDataChange({ ...data, [field.name]: rows })}
        />
      </div>
    ))}
  </div>
)
