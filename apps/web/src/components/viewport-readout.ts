export interface ViewportHeights {
  vh: number
  inner_height: number
  html: number
}

const px = (value: number): string => `${Math.round(value)} px`

export const formatViewportReadout = ({ vh, inner_height, html }: ViewportHeights): string =>
  `Viewport: 100vh = ${px(vh)} · innerHeight = ${px(inner_height)} · html = ${px(html)}`
