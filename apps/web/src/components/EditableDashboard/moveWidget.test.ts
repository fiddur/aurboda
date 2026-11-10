import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { dropWidget, moveSection, moveWidget } from './moveWidget'

const widget = (id: string): DashboardWidget => ({
  config: { href: `/${id}`, label: id },
  id,
  type: 'quick_link',
})

const config = (): DashboardConfig => ({
  sections: [
    { id: 'a', title: 'A', type: 'links', widgets: ['a1', 'a2', 'a3', 'a4'].map(widget) },
    { id: 'b', title: 'B', type: 'links', widgets: ['b1', 'b2'].map(widget) },
    { id: 'empty', title: 'Empty', type: 'links', widgets: [] },
  ],
  version: 1,
})

const ids = (c: DashboardConfig) =>
  Object.fromEntries(c.sections.map((s) => [s.id, s.widgets.map((w) => w.id)]))

describe('moveWidget', () => {
  it('moves a widget forward within its section', () => {
    expect(ids(moveWidget(config(), 'a1', 'a', 2))).toEqual({
      a: ['a2', 'a3', 'a1', 'a4'],
      b: ['b1', 'b2'],
      empty: [],
    })
  })

  it('moves a widget backward within its section', () => {
    expect(ids(moveWidget(config(), 'a4', 'a', 1)).a).toEqual(['a1', 'a4', 'a2', 'a3'])
  })

  it('moves a widget to the top of its section', () => {
    expect(ids(moveWidget(config(), 'a4', 'a', 0)).a).toEqual(['a4', 'a1', 'a2', 'a3'])
  })

  it('moves a widget to another section at an index', () => {
    expect(ids(moveWidget(config(), 'a2', 'b', 1))).toEqual({
      a: ['a1', 'a3', 'a4'],
      b: ['b1', 'a2', 'b2'],
      empty: [],
    })
  })

  it('moves a widget into an empty section', () => {
    expect(ids(moveWidget(config(), 'b2', 'empty', 0))).toEqual({
      a: ['a1', 'a2', 'a3', 'a4'],
      b: ['b1'],
      empty: ['b2'],
    })
  })

  it('clamps the index to the target bounds', () => {
    expect(ids(moveWidget(config(), 'a1', 'b', 99)).b).toEqual(['b1', 'b2', 'a1'])
    expect(ids(moveWidget(config(), 'a1', 'b', -5)).b).toEqual(['a1', 'b1', 'b2'])
    expect(ids(moveWidget(config(), 'a1', 'a', 99)).a).toEqual(['a2', 'a3', 'a4', 'a1'])
  })

  it('returns the config unchanged for an unknown widget or section', () => {
    const c = config()
    expect(moveWidget(c, 'nope', 'a', 0)).toBe(c)
    expect(moveWidget(c, 'a1', 'nope', 0)).toBe(c)
  })

  it('does not mutate the input', () => {
    const c = config()
    const before = structuredClone(c)
    moveWidget(c, 'a1', 'b', 0)
    moveWidget(c, 'a1', 'a', 3)
    expect(c).toEqual(before)
  })

  it('keeps the moved widget object and other fields', () => {
    const c = { ...config(), description: 'intro' }
    const moved = moveWidget(c, 'a3', 'b', 0)
    expect(moved.description).toBe('intro')
    expect(moved.sections[1].widgets[0]).toBe(c.sections[0].widgets[2])
    expect(moved.sections[2]).toBe(c.sections[2])
  })
})

describe('dropWidget', () => {
  it('drops before or after a widget in the same section', () => {
    expect(ids(dropWidget(config(), 'a4', { sectionId: 'a', side: 'before', widgetId: 'a2' })).a).toEqual([
      'a1',
      'a4',
      'a2',
      'a3',
    ])
    expect(ids(dropWidget(config(), 'a1', { sectionId: 'a', side: 'after', widgetId: 'a3' })).a).toEqual([
      'a2',
      'a3',
      'a1',
      'a4',
    ])
  })

  it('drops next to a widget in another section', () => {
    expect(ids(dropWidget(config(), 'a1', { sectionId: 'b', side: 'after', widgetId: 'b1' }))).toEqual({
      a: ['a2', 'a3', 'a4'],
      b: ['b1', 'a1', 'b2'],
      empty: [],
    })
  })

  it('drops at the end of a section without a widget target', () => {
    expect(ids(dropWidget(config(), 'a1', { sectionId: 'empty' })).empty).toEqual(['a1'])
    expect(ids(dropWidget(config(), 'a1', { sectionId: 'a' })).a).toEqual(['a2', 'a3', 'a4', 'a1'])
  })

  it('returns the same config when nothing would move', () => {
    const c = config()
    expect(dropWidget(c, 'a2', { sectionId: 'a', side: 'before', widgetId: 'a2' })).toBe(c)
    expect(dropWidget(c, 'a2', { sectionId: 'a', side: 'after', widgetId: 'a1' })).toBe(c)
    expect(dropWidget(c, 'a2', { sectionId: 'a', side: 'before', widgetId: 'a3' })).toBe(c)
    expect(dropWidget(c, 'a4', { sectionId: 'a' })).toBe(c)
    expect(dropWidget(c, 'a1', { sectionId: 'nope' })).toBe(c)
  })
})

describe('moveSection', () => {
  const sectionsConfig: DashboardConfig = {
    sections: ['a', 'b', 'c'].map((id) => ({ id, title: id, type: 'links' as const, widgets: [] })),
    version: 1,
  }
  const sectionIds = (c: DashboardConfig) => c.sections.map((s) => s.id)

  it('moves a section one step up or down', () => {
    expect(sectionIds(moveSection(sectionsConfig, 'b', 'up'))).toEqual(['b', 'a', 'c'])
    expect(sectionIds(moveSection(sectionsConfig, 'b', 'down'))).toEqual(['a', 'c', 'b'])
  })

  it('leaves the config as it is at either end or for an unknown section', () => {
    expect(moveSection(sectionsConfig, 'a', 'up')).toBe(sectionsConfig)
    expect(moveSection(sectionsConfig, 'c', 'down')).toBe(sectionsConfig)
    expect(moveSection(sectionsConfig, 'x', 'up')).toBe(sectionsConfig)
  })

  it('does not mutate the input', () => {
    moveSection(sectionsConfig, 'b', 'up')
    expect(sectionIds(sectionsConfig)).toEqual(['a', 'b', 'c'])
  })
})
