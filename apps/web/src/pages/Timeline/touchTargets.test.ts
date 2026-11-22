// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  ensureParkingGroup,
  PARKING_CLASS,
  parkDetachedTargets,
  recordTouchTargets,
  releaseParkedTargets,
} from './touchTargets'

const SVG_NS = 'http://www.w3.org/2000/svg'

const setup = () => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const chart = document.createElementNS(SVG_NS, 'g')
  const link = document.createElementNS(SVG_NS, 'a')
  const bar = document.createElementNS(SVG_NS, 'rect')
  link.appendChild(bar)
  chart.appendChild(link)
  svg.appendChild(chart)
  document.body.appendChild(svg)
  return { bar, chart, link, svg }
}

const parkingGroups = (svg: SVGSVGElement) => svg.querySelectorAll(`.${PARKING_CLASS}`)

describe('recordTouchTargets', () => {
  it('collects the target of every changed touch, so both fingers of a pinch are kept', () => {
    const { bar, chart } = setup()
    const targets = new Set<Node>()
    recordTouchTargets(targets, { changedTouches: [{ target: bar }, { target: chart }] })
    recordTouchTargets(targets, { changedTouches: [{ target: bar }, { target: null }] })
    expect([...targets]).toEqual([bar, chart])
  })
})

describe('ensureParkingGroup', () => {
  it('adds one hidden group that cannot be hit, outside the chart, and reuses it', () => {
    const { chart, svg } = setup()
    const group = ensureParkingGroup(svg)
    expect(group.parentNode).toBe(svg)
    expect(chart.contains(group)).toBe(false)
    expect(group.getAttribute('visibility')).toBe('hidden')
    expect(group.getAttribute('pointer-events')).toBe('none')
    expect(ensureParkingGroup(svg)).toBe(group)
    expect(parkingGroups(svg)).toHaveLength(1)
  })
})

describe('parkDetachedTargets', () => {
  it('leaves a target that is still in the svg where it is', () => {
    const { bar, link, svg } = setup()
    parkDetachedTargets([bar], svg)
    expect(bar.parentNode).toBe(link)
    expect(parkingGroups(svg)).toHaveLength(0)
  })

  it('puts a target a redraw removed back into the svg, inside the parking group', () => {
    const { bar, chart, svg } = setup()
    chart.replaceChildren()
    parkDetachedTargets([bar], svg)
    expect(svg.contains(bar)).toBe(true)
    expect(bar.parentElement?.classList.contains(PARKING_CLASS)).toBe(true)
  })

  it('keeps a parked target parked through later redraws', () => {
    const { bar, chart, svg } = setup()
    chart.replaceChildren()
    parkDetachedTargets([bar], svg)
    const group = bar.parentElement
    chart.replaceChildren()
    parkDetachedTargets([bar], svg)
    expect(bar.parentElement).toBe(group)
  })

  it('recreates the parking group after a scaffold rebuild removed it', () => {
    const { bar, chart, svg } = setup()
    chart.replaceChildren()
    parkDetachedTargets([bar], svg)
    svg.replaceChildren()
    parkDetachedTargets([bar], svg)
    expect(bar.parentElement?.parentNode).toBe(svg)
    expect(parkingGroups(svg)).toHaveLength(1)
  })

  it('ignores the svg itself as a target', () => {
    const { svg } = setup()
    parkDetachedTargets([svg], svg)
    expect(parkingGroups(svg)).toHaveLength(0)
  })
})

describe('releaseParkedTargets', () => {
  it('empties the parking group', () => {
    const { bar, chart, svg } = setup()
    chart.replaceChildren()
    parkDetachedTargets([bar], svg)
    releaseParkedTargets(svg)
    expect(svg.contains(bar)).toBe(false)
    expect(parkingGroups(svg)[0]?.childNodes).toHaveLength(0)
  })
})
