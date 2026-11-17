import { strengthScoreHref } from '../../components/sessions/sessionView'
import { useStrengthScore } from '../StrengthScore/queries'
import { groupScoresLine } from '../StrengthScore/strengthScoreView'

/** The type's strength score in brief, linking to the page with the lifts and history behind it. */
export function StrengthScoreSection({ name, path }: { name: string; path: string }) {
  const { data } = useStrengthScore(name, path)
  if (!data) return null
  const href = strengthScoreHref(name, path)
  return (
    <section class="activity-type-meta-section">
      <h2>Strength score</h2>
      {data.score === null ? (
        <p class="activity-type-meta-strength-score-muted">
          No score yet. <a href={href}>What counts</a>
        </p>
      ) : (
        <>
          <div class="activity-type-meta-strength-score-value">{data.score}</div>
          <p class="activity-type-meta-strength-score-muted">{groupScoresLine(data)}</p>
          <a href={href}>Lifts and history</a>
        </>
      )}
    </section>
  )
}
