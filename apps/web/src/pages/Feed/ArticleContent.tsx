/**
 * Render an article post inline: its title followed by the ordered content
 * blocks. Prose blocks go through the shared markdown sanitiser (#910 — the XSS
 * boundary; article prose may be authored by AI or, later, a different user).
 * Chart, correlation and impact blocks resolve their effective window (own override else
 * the article default) and render live via `ArticleChartBlock` /
 * `ArticleCorrelationBlock`, and an impact block via `ArticleImpactBlock`; a
 * challenge block renders live via `LiveArticleChallenge`.
 */
import type { ArticleContent as ArticleContentType } from '@aurboda/api-spec'

import { DEFAULT_IMPACT_WINDOW_MINUTES } from '@aurboda/api-spec'

import { renderMarkdown } from '../../utils/markdown'
import { LiveArticleChallenge } from './ArticleChallengeBlock'
import { ArticleChartBlock } from './ArticleChartBlock'
import { ArticleCorrelationBlock } from './ArticleCorrelationBlock'
import { ArticleImpactBlock } from './ArticleImpactBlock'

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
      if (block.type === 'challenge') {
        return (
          <LiveArticleChallenge key={`challenge-${i}`} url={block.challenge_url} caption={block.caption} />
        )
      }
      const start = block.start ?? article.default_start
      const end = block.end ?? article.default_end
      if (block.type === 'impact') {
        if (start == null || end == null) {
          return (
            <p key={`impact-${i}`} class="article-chart-note">
              This impact chart has no time window.
            </p>
          )
        }
        return (
          <ArticleImpactBlock
            key={`impact-${i}`}
            activity={block.activity}
            activityType={block.activity_type}
            caption={block.caption}
            end={end}
            start={start}
            windowMinutes={block.window_minutes ?? DEFAULT_IMPACT_WINDOW_MINUTES}
          />
        )
      }
      if (block.type === 'correlation') {
        if (start == null || end == null) {
          return (
            <p key={`corr-${i}`} class="article-chart-note">
              This correlation has no time window.
            </p>
          )
        }
        return (
          <ArticleCorrelationBlock
            key={`corr-${i}`}
            caption={block.caption}
            end={end}
            lagDays={block.lag_days}
            outcome={block.outcome}
            start={start}
            trigger={block.trigger}
          />
        )
      }
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
