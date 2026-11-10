import type { DashboardConfig } from '@aurboda/api-spec'

/**
 * The config with `widgetId` taken out of its section and inserted at `targetIndex` in
 * `targetSectionId`. The index is into the target's widgets after the removal, clamped to its
 * bounds; an unknown widget or section leaves the config as it is.
 */
export const moveWidget = (
  config: DashboardConfig,
  widgetId: string,
  targetSectionId: string,
  targetIndex: number,
): DashboardConfig => {
  const source = config.sections.find((s) => s.widgets.some((w) => w.id === widgetId))
  const widget = source?.widgets.find((w) => w.id === widgetId)
  const target = config.sections.find((s) => s.id === targetSectionId)
  if (!source || !widget || !target) return config

  const remaining = (sectionWidgets: typeof source.widgets) => sectionWidgets.filter((w) => w.id !== widgetId)
  const targetWidgets = remaining(target.widgets)
  const index = Math.max(0, Math.min(Math.trunc(targetIndex), targetWidgets.length))

  return {
    ...config,
    sections: config.sections.map((section) => {
      if (section.id === target.id) {
        return {
          ...section,
          widgets: [...targetWidgets.slice(0, index), widget, ...targetWidgets.slice(index)],
        }
      }
      if (section.id === source.id) return { ...section, widgets: remaining(section.widgets) }
      return section
    }),
  }
}

/** Where a dragged widget would land: next to `widgetId`, or at the end of the section without one. */
export interface DropTarget {
  sectionId: string
  widgetId?: string
  side?: 'after' | 'before'
}

/**
 * The config with `draggedId` dropped on `target`, or the same config object when the drop would
 * leave every widget where it is.
 */
export const dropWidget = (
  config: DashboardConfig,
  draggedId: string,
  target: DropTarget,
): DashboardConfig => {
  if (target.widgetId === draggedId) return config
  const section = config.sections.find((s) => s.id === target.sectionId)
  if (!section) return config

  const rest = section.widgets.filter((w) => w.id !== draggedId)
  const at = target.widgetId === undefined ? -1 : rest.findIndex((w) => w.id === target.widgetId)
  const index = at === -1 ? rest.length : target.side === 'after' ? at + 1 : at

  if (section.widgets.findIndex((w) => w.id === draggedId) === index) return config
  return moveWidget(config, draggedId, target.sectionId, index)
}

/** The config with section `sectionId` moved one step up or down; unchanged at either end. */
export const moveSection = (
  config: DashboardConfig,
  sectionId: string,
  direction: 'down' | 'up',
): DashboardConfig => {
  const from = config.sections.findIndex((s) => s.id === sectionId)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from === -1 || to < 0 || to >= config.sections.length) return config
  const sections = [...config.sections]
  const [section] = sections.splice(from, 1)
  sections.splice(to, 0, section)
  return { ...config, sections }
}
