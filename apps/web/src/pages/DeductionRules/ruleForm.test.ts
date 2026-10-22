import { describe, expect, test } from 'vitest'

import type { DeductionRule } from '../../state/api'

import {
  defaultFields,
  fieldsToBuildBody,
  modeChangeBody,
  ruleToFields,
  toOutputTitleField,
} from './ruleForm'

const rule = (over: Partial<DeductionRule> = {}): DeductionRule => ({
  conditions: [{ activity_type: 'yoga', kind: 'activity' }],
  enabled: true,
  id: 'r1',
  mode: 'enrich',
  name: 'Yoga title',
  output_activity_type: 'yoga',
  priority: 0,
  ...over,
})

describe('output_title_field form mapping', () => {
  test('reads the rule field into the form', () => {
    expect(ruleToFields(rule({ output_title_field: 'session_name' })).titleField).toBe('session_name')
    expect(ruleToFields(rule()).titleField).toBe('')
  })

  test('sends the trimmed field in enrich mode and nothing when empty', () => {
    const fields = { ...defaultFields, mode: 'enrich' as const, titleField: ' session_name ' }
    expect(fieldsToBuildBody(fields).output_title_field).toBe('session_name')
    expect(fieldsToBuildBody({ ...fields, titleField: '  ' }).output_title_field).toBeUndefined()
  })

  test('never sends it outside enrich mode', () => {
    expect(
      toOutputTitleField({ ...defaultFields, mode: 'create', titleField: 'session_name' }),
    ).toBeUndefined()
  })

  test('round-trips through the form', () => {
    const original = rule({ output_title_field: 'session_name' })
    expect(fieldsToBuildBody(ruleToFields(original)).output_title_field).toBe('session_name')
  })
})

describe('modeChangeBody', () => {
  test('leaving enrich clears both enrich-only outputs', () => {
    const titling = rule({
      output_media_field: { field: 'session_name' },
      output_title_field: 'session_name',
    })
    expect(modeChangeBody('create', titling)).toEqual({
      mode: 'create',
      output_media_field: null,
      output_title_field: null,
    })
  })

  test('clears only what the rule has', () => {
    expect(modeChangeBody('retype', rule({ output_title_field: 'session_name' }))).toEqual({
      mode: 'retype',
      output_title_field: null,
    })
    expect(modeChangeBody('create', rule())).toEqual({ mode: 'create' })
  })

  test('switching to enrich clears nothing', () => {
    expect(modeChangeBody('enrich', rule({ mode: 'create', output_title_field: 'x' }))).toEqual({
      mode: 'enrich',
    })
  })
})
