import { describe, expect, test } from 'vitest'

import {
  buildDashboardShareBody,
  type DashboardShareForm,
  dashboardSharePreviewKey,
} from './dashboard-share-body'

const form: DashboardShareForm = {
  dashboardId: '00000000-0000-4000-8000-000000000001',
  includeLink: true,
  message: '',
  period: '2026-10',
  published: true,
  visibility: 'public',
}

describe('buildDashboardShareBody', () => {
  test('maps the form onto the body', () => {
    expect(buildDashboardShareBody(form)).toEqual({
      dashboard_id: '00000000-0000-4000-8000-000000000001',
      include_link: true,
      period: '2026-10',
      visibility: 'public',
    })
  })

  test('the home dashboard sends no id', () => {
    expect(buildDashboardShareBody({ ...form, dashboardId: undefined })).not.toHaveProperty('dashboard_id')
  })

  test('trims the message and omits a blank one', () => {
    expect(buildDashboardShareBody({ ...form, message: '  Good month\n' }).message).toBe('Good month')
    expect(buildDashboardShareBody({ ...form, message: '   ' })).not.toHaveProperty('message')
  })

  test('includes no link when the dashboard is not published, or the link is unchecked', () => {
    expect(buildDashboardShareBody({ ...form, published: false }).include_link).toBe(false)
    expect(buildDashboardShareBody({ ...form, includeLink: false }).include_link).toBe(false)
  })

  test('sends tags only when given', () => {
    expect(buildDashboardShareBody(form)).not.toHaveProperty('tags')
    expect(buildDashboardShareBody({ ...form, tags: [] }).tags).toEqual([])
    expect(buildDashboardShareBody({ ...form, tags: ['stats'] }).tags).toEqual(['stats'])
  })
})

describe('dashboardSharePreviewKey', () => {
  test('ignores the visibility', () => {
    const body = buildDashboardShareBody(form)
    expect(dashboardSharePreviewKey({ ...body, visibility: 'followers' })).toBe(
      dashboardSharePreviewKey(body),
    )
    expect(JSON.parse(dashboardSharePreviewKey(body))).not.toHaveProperty('visibility')
  })

  test('changes with the period and the link', () => {
    const body = buildDashboardShareBody(form)
    expect(dashboardSharePreviewKey({ ...body, period: '2026-09' })).not.toBe(dashboardSharePreviewKey(body))
    expect(dashboardSharePreviewKey({ ...body, include_link: false })).not.toBe(
      dashboardSharePreviewKey(body),
    )
  })
})
