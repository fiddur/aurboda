import type { DashboardConfig } from '@aurboda/api-spec'

/**
 * Strip viewer-useless / internal fields from a config before exposing it.
 * Quick links point into the owner's private app, so neutralize their hrefs.
 */
export const sanitizeConfig = (config: DashboardConfig): DashboardConfig => ({
  // Author prose is meant for public viewers — preserve it (section descriptions
  // survive via the section spread below).
  description: config.description,
  ...(config.period ? { period: config.period } : {}),
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) =>
      widget.type === 'quick_link' ? { ...widget, config: { ...widget.config, href: '#' } } : widget,
    ),
  })),
  version: config.version,
})
