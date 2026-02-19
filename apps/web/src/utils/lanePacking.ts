/**
 * Greedy interval scheduling for lane packing.
 * Assigns items to the minimum number of lanes such that no two items in the same lane overlap.
 */

const SYNTHETIC_DURATION_MS = 15 * 60 * 1000 // 15 minutes for point-in-time items

export interface PackedItem<T> {
  item: T
  lane: number
}

export interface PackResult<T> {
  items: PackedItem<T>[]
  laneCount: number
}

export const packLanes = <T>(
  items: readonly T[],
  getStart: (item: T) => Date,
  getEnd: (item: T) => Date | undefined,
): PackResult<T> => {
  if (items.length === 0) return { items: [], laneCount: 0 }

  const sorted = [...items].sort((a, b) => getStart(a).getTime() - getStart(b).getTime())

  // Track the end time of each lane
  const laneEnds: number[] = []
  const result: PackedItem<T>[] = []

  for (const item of sorted) {
    const start = getStart(item).getTime()
    const end = getEnd(item)?.getTime() ?? start + SYNTHETIC_DURATION_MS

    // Find the first lane whose end <= item start
    let assignedLane = -1
    for (let i = 0; i < laneEnds.length; i++) {
      if ((laneEnds[i] ?? 0) <= start) {
        assignedLane = i
        break
      }
    }

    if (assignedLane === -1) {
      assignedLane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[assignedLane] = end
    }

    result.push({ item, lane: assignedLane })
  }

  return { items: result, laneCount: laneEnds.length }
}
