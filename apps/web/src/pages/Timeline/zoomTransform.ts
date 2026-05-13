import * as d3 from 'd3'

export const computeVerticalZoomTransform = (
  baseScale: d3.ScaleTime<number, number>,
  vStart: Date,
  vEnd: Date,
  chartHeight: number,
): d3.ZoomTransform => {
  const by0 = baseScale(vStart)
  const by1 = baseScale(vEnd)
  const k = chartHeight / (by1 - by0)
  return d3.zoomIdentity.translate(0, -k * by0).scale(k)
}

export const computeHorizontalZoomTransform = (
  baseScale: d3.ScaleTime<number, number>,
  vStart: Date,
  vEnd: Date,
  chartWidth: number,
): d3.ZoomTransform => {
  const bx0 = baseScale(vStart)
  const bx1 = baseScale(vEnd)
  const k = chartWidth / (bx1 - bx0)
  return d3.zoomIdentity.translate(-k * bx0, 0).scale(k)
}
