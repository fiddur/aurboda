/**
 * Render an article post inline: its title followed by the ordered content
 * blocks. Prose blocks go through the shared markdown sanitiser (#910 — the XSS
 * boundary; article prose may be authored by AI or, later, a different user).
 * Chart blocks resolve their effective window (own override else the article
 * default) and render live via `ArticleChartBlock`.
 */
import type { ArticleContent as ArticleContentType } from '@aurboda/api-spec'

import { renderMarkdown } from '../../utils/markdown'
import { ArticleChartBlock } from './ArticleChartBlock'

export const ArticleContent = ({ article }: { article: ArticleContentType }) => (
  <div class="article-content">
    <h3 class="article-title">{article.title}</h3>
    {article.blocks.map((block, i) => {
      if (block.type === 'prose') {
        return (
          <div
            key={`prose-${i}`}
            class="article-prose"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown) }}
          />
        )
      }
      const start = block.start ?? article.default_start
      const end = block.end ?? article.default_end
      if (start == null || end == null) {
        return (
          <p key={`chart-${i}`} class="article-chart-note">
            This chart has no time window.
          </p>
        )
      }
      return (
        <ArticleChartBlock
          key={`chart-${i}`}
          bucket={block.bucket}
          caption={block.caption}
          end={end}
          metric={block.metric}
          start={start}
        />
      )
    })}
  </div>
)
