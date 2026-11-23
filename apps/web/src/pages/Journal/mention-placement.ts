export interface MentionPlacement {
  side: 'below' | 'above'
  /** CSS `top` (below) or `bottom` (above) relative to the editor's wrap. */
  offset: number
  maxHeight: number
}

/**
 * Where the `@` menu goes: under the caret line when it fits, else above it, inside the visible part
 * of the viewport (the visual viewport, which the soft keyboard shrinks). All positions are viewport
 * coordinates.
 */
export const mentionMenuPlacement = ({
  caretTop,
  caretBottom,
  wrapTop,
  wrapBottom,
  visibleTop,
  visibleBottom,
  cap,
  minUseful = 120,
  gap = 4,
}: {
  caretTop: number
  caretBottom: number
  wrapTop: number
  wrapBottom: number
  visibleTop: number
  visibleBottom: number
  cap: number
  minUseful?: number
  gap?: number
}): MentionPlacement => {
  const below = visibleBottom - caretBottom - gap
  const above = caretTop - visibleTop - gap
  const side = below >= Math.min(cap, minUseful) || below >= above ? 'below' : 'above'
  const space = side === 'below' ? below : above
  return {
    maxHeight: Math.max(0, Math.min(cap, space), Math.min(cap, 80)),
    offset: side === 'below' ? caretBottom - wrapTop + gap : wrapBottom - caretTop + gap,
    side,
  }
}
