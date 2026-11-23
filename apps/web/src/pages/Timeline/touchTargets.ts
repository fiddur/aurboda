const SVG_NS = 'http://www.w3.org/2000/svg'
export const PARKING_CLASS = 'touch-parking'

/**
 * A touch's later events go to the element it started on even after that element has left
 * the document, and then they no longer bubble to the svg where d3-zoom listens. Redraws
 * rebuild every bar, so the start target of each touch is kept here until the gesture ends.
 */
export const recordTouchTargets = (
  targets: Set<Node>,
  event: { changedTouches: ArrayLike<{ target: EventTarget | null }> },
): void => {
  for (const touch of Array.from(event.changedTouches)) {
    if (touch.target instanceof Node) targets.add(touch.target)
  }
}

export const ensureParkingGroup = (svg: SVGSVGElement): SVGGElement => {
  const existing = Array.from(svg.children).find((child) => child.classList.contains(PARKING_CLASS))
  if (existing) return existing as SVGGElement
  const group = svg.ownerDocument.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', PARKING_CLASS)
  group.setAttribute('visibility', 'hidden')
  group.setAttribute('pointer-events', 'none')
  svg.appendChild(group)
  return group
}

/**
 * Puts every touch target a redraw removed back into the svg, inside a hidden group that cannot
 * be hit, so the rest of the gesture's events still bubble to the svg. Call it right after a
 * redraw: no touch event is dispatched while the draw runs, so re-inserting afterwards is as
 * good as moving the node before it was removed, and it also covers nodes that d3 joins remove
 * (axis ticks leaving the view).
 */
export const parkDetachedTargets = (targets: Iterable<Node>, svg: SVGSVGElement): void => {
  let parking: SVGGElement | null = null
  for (const target of targets) {
    if (target === svg || svg.contains(target)) continue
    parking ??= ensureParkingGroup(svg)
    parking.appendChild(target)
  }
}

export const releaseParkedTargets = (svg: SVGSVGElement): void => {
  for (const child of Array.from(svg.children)) {
    if (child.classList.contains(PARKING_CLASS)) child.replaceChildren()
  }
}
