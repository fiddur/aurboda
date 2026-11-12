/**
 * A chart with a title band above it naming the figure (`Figure N` and its
 * caption), for the article Note's attachments: Mastodon lays attachments out
 * after the text, so the image itself has to say which reference it answers.
 * The text is centred because Mastodon's two-image grid shows only the middle of
 * each image.
 */
import type { ArticleBlock } from '@aurboda/api-spec'

import { CHART_HEIGHT, CHART_WIDTH, escapeXml } from './chart-svg.ts'
import { IMPACT_HEIGHT, IMPACT_WIDTH } from './impact-svg.ts'
import { SCATTER_HEIGHT, SCATTER_WIDTH } from './scatter-svg.ts'

export const FIGURE_BAND_HEIGHT = 88

/** The chart a block's figure draws, without the title band: the Note's attachment size and the figure route's must agree. */
export const articleBlockFigureSize = (
  blockType: Exclude<ArticleBlock['type'], 'prose'>,
): { width: number; height: number } => {
  switch (blockType) {
    case 'correlation':
      return { height: SCATTER_HEIGHT, width: SCATTER_WIDTH }
    case 'impact':
      return { height: IMPACT_HEIGHT, width: IMPACT_WIDTH }
    case 'chart':
    case 'challenge':
      return { height: CHART_HEIGHT, width: CHART_WIDTH }
  }
}

const BG = '#0b0f19'
const HEADING_COLOR = '#e5e7eb'
const CAPTION_COLOR = '#9ca3af'
const FONT = 'Liberation Sans, sans-serif'
const CAPTION_CHAR_WIDTH = 11

const fitCaption = (caption: string, width: number): string => {
  const max = Math.floor(width / CAPTION_CHAR_WIDTH)
  return caption.length <= max ? caption : `${caption.slice(0, max - 1).trimEnd()}…`
}

export const withFigureTitle = (
  chartSvg: string,
  size: { width: number; height: number },
  title: { heading: string; caption?: string },
): string => {
  if (!chartSvg.startsWith('<svg ')) throw new Error('withFigureTitle: chart is not an <svg> element')
  const { height, width } = size
  const total = height + FIGURE_BAND_HEIGHT
  const centre = width / 2
  const nested = `<svg x="0" y="${FIGURE_BAND_HEIGHT}" ${chartSvg.slice('<svg '.length)}`
  const caption = title.caption
    ? `<text x="${centre}" y="72" text-anchor="middle" font-family="${FONT}" font-size="20" fill="${CAPTION_COLOR}">${escapeXml(fitCaption(title.caption, width))}</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">
  <rect width="${width}" height="${total}" fill="${BG}" rx="16"/>
  <text x="${centre}" y="40" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="bold" fill="${HEADING_COLOR}">${escapeXml(title.heading)}</text>
  ${caption}
  ${nested}
</svg>`
}
