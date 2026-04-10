/**
 * Renders activity data fields based on an activity type's data schema definition.
 * Shows labeled values for declared fields, and a greyed-out section for extra undeclared fields.
 * Internal fields (_enriched_by, rule_id, rule_name) are rendered specially or hidden.
 * In edit mode, renders appropriate inputs per field type.
 */
import type { DataFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

const INTERNAL_KEYS = new Set(['_enriched_by', 'rule_id', 'rule_name'])

const capitalize = (s: string) =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

const formatValue = (value: unknown, unit?: string): string => {
  const str = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return unit ? `${str} ${unit}` : str
}

const EnrichedByLink = ({ value }: { value: unknown }) => {
  if (typeof value === 'object' && value !== null && 'rule_id' in value) {
    const { rule_id, rule_name } = value as { rule_id: string; rule_name: string }
    return (
      <div class="field-row" style={{ opacity: 0.7 }}>
        <span class="field-label">Enriched by</span>
        <span class="field-value">
          <a href={`/deduction-rules/${rule_id}`}>{rule_name}</a>
        </span>
      </div>
    )
  }
  // Legacy format: just a rule ID string
  if (typeof value === 'string') {
    return (
      <div class="field-row" style={{ opacity: 0.7 }}>
        <span class="field-label">Enriched by</span>
        <span class="field-value">
          <a href={`/deduction-rules/${value}`}>{value.slice(0, 8)}...</a>
        </span>
      </div>
    )
  }
  return null
}

const FieldInput = ({
  field,
  value,
  onChange,
}: {
  field: DataFieldDefinition
  value: unknown
  onChange: (value: unknown) => void
}) => {
  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
    )
  }

  if (field.type === 'string' && field.enum_values) {
    return (
      <select
        class="edit-datetime-input"
        value={(value as string) ?? ''}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          onChange(v || null)
        }}
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
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <input
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

  // Default: string text input
  return (
    <input
      type="text"
      class="edit-datetime-input"
      value={(value as string) ?? ''}
      onInput={(e) => {
        const v = (e.target as HTMLInputElement).value
        onChange(v || null)
      }}
    />
  )
}

export const SchemaDataFields = ({
  data,
  schema,
  isEditing,
  onDataChange,
}: {
  data: Record<string, unknown>
  schema: DataSchemaDefinition
  isEditing?: boolean
  onDataChange?: (data: Record<string, unknown>) => void
}) => {
  const schemaFieldNames = new Set(schema.fields.map((f) => f.name))
  const extraKeys = Object.keys(data).filter((k) => !schemaFieldNames.has(k) && !INTERNAL_KEYS.has(k))
  const enrichedBy = data._enriched_by

  const updateField = (name: string, value: unknown) => {
    if (!onDataChange) return
    const updated = { ...data, [name]: value }
    onDataChange(updated)
  }

  if (isEditing) {
    return (
      <div class="entity-fields">
        {schema.fields.map((field) => (
          <div class="field-row" key={field.name}>
            <span class="field-label">{field.label ?? capitalize(field.name)}</span>
            <span class="field-value">
              <FieldInput
                field={field}
                value={data[field.name]}
                onChange={(value) => updateField(field.name, value)}
              />
            </span>
          </div>
        ))}
        {extraKeys.map((key) => {
          const value = data[key]
          if (value === undefined || value === null) return null
          return (
            <div class="field-row" key={key} style={{ opacity: 0.6 }}>
              <span class="field-label">{capitalize(key)}</span>
              <span class="field-value">{String(value)}</span>
            </div>
          )
        })}
        {enrichedBy && <EnrichedByLink value={enrichedBy} />}
      </div>
    )
  }

  return (
    <div class="entity-fields">
      {schema.fields.map((field) => {
        const value = data[field.name]
        if (value === undefined || value === null) return null
        return (
          <div class="field-row" key={field.name}>
            <span class="field-label">{field.label ?? capitalize(field.name)}</span>
            <span class="field-value">{formatValue(value, field.unit)}</span>
          </div>
        )
      })}
      {extraKeys.map((key) => {
        const value = data[key]
        if (value === undefined || value === null) return null
        return (
          <div class="field-row" key={key} style={{ opacity: 0.6 }}>
            <span class="field-label">{capitalize(key)}</span>
            <span class="field-value">{String(value)}</span>
          </div>
        )
      })}
      {enrichedBy && <EnrichedByLink value={enrichedBy} />}
    </div>
  )
}
