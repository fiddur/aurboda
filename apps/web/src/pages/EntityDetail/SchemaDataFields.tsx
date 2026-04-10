/**
 * Renders activity data fields based on an activity type's data schema definition.
 * Shows labeled values for declared fields, and a greyed-out section for extra undeclared fields.
 * Internal fields (_enriched_by, rule_id, rule_name) are rendered specially or hidden.
 */
import type { DataSchemaDefinition } from '@aurboda/api-spec'

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

export const SchemaDataFields = ({
  data,
  schema,
}: {
  data: Record<string, unknown>
  schema: DataSchemaDefinition
}) => {
  const schemaFieldNames = new Set(schema.fields.map((f) => f.name))
  const extraKeys = Object.keys(data).filter((k) => !schemaFieldNames.has(k) && !INTERNAL_KEYS.has(k))
  const enrichedBy = data._enriched_by

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
