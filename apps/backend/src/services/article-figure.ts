import type { PostChart } from './charts/post-chart-svg.ts'

import { articleBlockFigureSize, withFigureTitle } from './charts/figure-svg.ts'
import { postChartSvg } from './charts/post-chart-svg.ts'
import { articleBlockChart, type PostChartDeps, type ResolvedArticleBlock } from './post-chart.ts'

export type ArticleChartDeps = Pick<
  PostChartDeps,
  'getArticleChartSeries' | 'getArticleImpact' | 'getChallengeRaceByUrl' | 'getCorrelationScatter'
>

/**
 * One article block's figure as SVG: its chart at the block's figure size under the title band
 * naming the figure (`Figure N` and its label), as the Note attaches it. `null` when the block has
 * too little data to draw. Shared by the `figure.png` route, which rasterises it, and the article
 * preview, which returns the markup.
 */
export const articleBlockFigureSvg = async (
  deps: ArticleChartDeps,
  user: string,
  block: ResolvedArticleBlock,
  figure: { number: number; label: string },
  chartSvg: (chart: PostChart) => Promise<string> | string = (chart) =>
    postChartSvg(chart, articleBlockFigureSize(block.type)),
): Promise<string | null> => {
  const chart = await articleBlockChart(deps, user, block)
  if (chart == null) return null
  const title = { caption: figure.label, heading: `Figure ${figure.number}` }
  return withFigureTitle(await chartSvg(chart), articleBlockFigureSize(block.type), title)
}
