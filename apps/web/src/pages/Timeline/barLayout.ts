/**
 * Bar layout system for the horizontal timeline.
 *
 * Computes side-by-side positions for bar-shaped data (steps, calories,
 * training load impulse bars, screentime). Each bar type gets an equal
 * fraction of the bucket width.
 *
 * Line/area charts (HR, HRV, CTL/ATL curves, TSB) are unaffected —
 * they span the full track width as overlays.
 */

export interface BarSlot {
  /** Unique identifier for this bar slot. */
  id: string
  /** Whether this slot is currently visible (for counting active slots). */
  visible: boolean
}

export interface BarLayoutResult {
  /** Total number of visible bar slots. */
  totalSlots: number
  /** Get the fractional x-offset (0..1) for a given slot id within a bucket. */
  getOffset: (slotId: string) => number
  /** Fractional width (0..1) of each bar slot within a bucket. */
  slotWidth: number
}

/**
 * Compute bar layout from the list of active bar slots.
 * Each visible slot gets an equal share of the bucket width.
 *
 * Returns a layout object that maps slot IDs to their fractional x-offset.
 */
export const computeBarLayout = (slots: BarSlot[]): BarLayoutResult => {
  const visibleSlots = slots.filter((s) => s.visible)
  const totalSlots = Math.max(visibleSlots.length, 1)
  const slotWidth = 1 / totalSlots

  const offsetMap = new Map<string, number>()
  let idx = 0
  for (const slot of slots) {
    if (slot.visible) {
      offsetMap.set(slot.id, idx * slotWidth)
      idx++
    }
  }

  return {
    getOffset: (slotId: string) => offsetMap.get(slotId) ?? 0,
    slotWidth,
    totalSlots,
  }
}

/**
 * Convert a fractional offset+width into pixel values for a specific bucket.
 */
export const slotPixels = (
  bucketX: number,
  bucketWidth: number,
  offset: number,
  slotWidth: number,
  gap: number = 0.5,
): { x: number; width: number } => ({
  width: Math.max(1, bucketWidth * slotWidth - gap),
  x: bucketX + bucketWidth * offset,
})
