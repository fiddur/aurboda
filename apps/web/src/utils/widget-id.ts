const randomId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export const newWidgetId = (): string => randomId('widget')

export const newSectionId = (): string => randomId('section')
