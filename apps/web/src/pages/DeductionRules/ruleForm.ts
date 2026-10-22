import type { DeductionRuleMode } from '@aurboda/api-spec'

import type {
  DeductionRule,
  DeductionRuleCondition,
  OutputMediaField,
  updateDeductionRule,
} from '../../state/api'

export interface RuleFormFields {
  conditions: DeductionRuleCondition[]
  enabled: boolean
  mediaField: string
  mediaStripPattern: string
  mergeGapMinutes: string
  mode: DeductionRuleMode
  name: string
  outputData: Record<string, unknown>
  outputTitle: string
  outputType: string
  priority: number
  titleField: string
}

type RuleUpdateBody = Parameters<typeof updateDeductionRule>[1]

export const defaultFields: RuleFormFields = {
  conditions: [{ kind: 'activity' }],
  enabled: true,
  mediaField: '',
  mediaStripPattern: '',
  mergeGapMinutes: '',
  mode: 'create',
  name: '',
  outputData: {},
  outputTitle: '',
  outputType: '',
  priority: 1,
  titleField: '',
}

export const ruleToFields = (rule: DeductionRule): RuleFormFields => ({
  conditions: rule.conditions,
  enabled: rule.enabled,
  mediaField: rule.output_media_field?.field ?? '',
  mediaStripPattern: rule.output_media_field?.strip_pattern ?? '',
  mergeGapMinutes: rule.merge_gap_seconds ? String(rule.merge_gap_seconds / 60) : '',
  mode: rule.mode ?? 'create',
  name: rule.name,
  outputData: rule.output_data ?? {},
  outputTitle: rule.output_title ?? '',
  outputType: rule.output_activity_type,
  priority: rule.priority,
  titleField: rule.output_title_field ?? '',
})

export const toOutputMediaField = (f: RuleFormFields): OutputMediaField | undefined =>
  f.mode === 'enrich' && f.mediaField
    ? { field: f.mediaField, ...(f.mediaStripPattern ? { strip_pattern: f.mediaStripPattern } : {}) }
    : undefined

export const toOutputTitleField = (f: RuleFormFields): string | undefined =>
  f.mode === 'enrich' && f.titleField.trim() ? f.titleField.trim() : undefined

export const fieldsToBuildBody = (f: RuleFormFields) => ({
  conditions: f.conditions,
  enabled: f.enabled,
  merge_gap_seconds: f.mergeGapMinutes ? Number(f.mergeGapMinutes) * 60 : undefined,
  mode: f.mode !== 'create' ? f.mode : undefined,
  name: f.name,
  output_activity_type: f.outputType,
  output_data: Object.keys(f.outputData).length > 0 ? f.outputData : undefined,
  output_media_field: toOutputMediaField(f),
  output_title: f.outputTitle || undefined,
  output_title_field: toOutputTitleField(f),
  priority: f.priority,
})

/** Leaving enrich mode clears the enrich-only outputs, which the API rejects in other modes. */
export const modeChangeBody = (mode: DeductionRuleMode, rule?: DeductionRule): RuleUpdateBody => ({
  mode,
  ...(mode !== 'enrich' && rule?.output_media_field ? { output_media_field: null } : {}),
  ...(mode !== 'enrich' && rule?.output_title_field ? { output_title_field: null } : {}),
})
