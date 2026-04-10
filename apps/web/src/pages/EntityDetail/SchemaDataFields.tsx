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

const RuleLink = ({
  ruleId,
  referencedRules,
  label,
}: {
  ruleId: string
  referencedRules?: Record<string, string>
  label: string
}) => {
  const ruleName = referencedRules?.[ruleId]
  return (
    <div class="field-row" style={{ opacity: 0.7 }}>
      <span class="field-label">{label}</span>
      <span class="field-value">
        <a href={`/deduction-rules/${ruleId}`}>{ruleName ?? ruleId.slice(0, 8) + '...'}</a>
      </span>
    </div>
  )
}

export const SchemaDataFields = ({
  data,
  schema,
  referencedRules,
}: {
  data: Record<string, unknown>
  schema: DataSchemaDefinition
  referencedRules?: Record<string, string>
}) => {
  const schemaFieldNames = new Set(schema.fields.map((f) => f.name))
  const extraKeys = Object.keys(data).filter((k) => !schemaFieldNames.has(k) && !INTERNAL_KEYS.has(k))

  const enrichedByRuleId = typeof data._enriched_by === 'string' ? data._enriched_by : undefined
  const createdByRuleId = typeof data.rule_id === 'string' ? data.rule_id : undefined

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
      {enrichedByRuleId && (
        <RuleLink ruleId={enrichedByRuleId} referencedRules={referencedRules} label="Enriched by" />
      )}
      {createdByRuleId && (
        <RuleLink ruleId={createdByRuleId} referencedRules={referencedRules} label="Created by rule" />
      )}
    </div>
  )
}
