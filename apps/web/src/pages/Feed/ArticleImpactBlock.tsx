/**
 * One impact block of an article: HRV, heart rate and stress before, during and
 * after each session of one activity over the block's locked window — the
 * Analyze page's impact chart. The owner's block fetches live
 * (`ArticleImpactBlock`); a visitor or a peer renders the resolved payload
 * (`ImpactBlockFigure`).
 */
import type { ActivityImpactType } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { ImpactFigure, type ImpactFigureData } from '../../components/charts/ImpactFigure'
import { fetchActivityImpactOver } from '../../state/api'

export interface ImpactBlockData extends ImpactFigureData {
  activity: string
  avg_duration_min: number
}

const ImpactTitle = ({ data }: { data: ImpactBlockData }) => (
  <div class="article-chart-title">
    Impact of "{data.activity}" on HRV, heart rate and stress
    <span class="article-chart-meta">
      {data.occurrences} occurrences, avg {Math.round(data.avg_duration_min)} min
    </span>
  </div>
)

const ImpactBody = ({ data }: { data: ImpactBlockData }) =>
  data.occurrences === 0 ? (
    <p class="article-chart-note">No sessions with data in this window.</p>
  ) : (
    <>
      <ImpactTitle data={data} />
      <ImpactFigure data={data} />
    </>
  )

export const ImpactBlockFigure = ({ data, caption }: { data: ImpactBlockData; caption?: string }) => (
  <figure class="article-chart">
    <ImpactBody data={data} />
    {caption && <figcaption class="article-chart-caption">{caption}</figcaption>}
  </figure>
)

export const ArticleImpactBlock = ({
  activity,
  activityType,
  windowMinutes,
  start,
  end,
  caption,
}: {
  activity: string
  activityType: ActivityImpactType
  windowMinutes: number
  start: string
  end: string
  caption?: string
}) => {
  const { data, isLoading, isError } = useQuery({
    queryFn: () => fetchActivityImpactOver({ activity, activityType, end, start, windowMinutes }),
    queryKey: ['article-impact', activity, activityType, start, end, windowMinutes],
  })

  return (
    <figure class="article-chart">
      {isLoading ? (
        <p class="article-chart-note">Loading impact…</p>
      ) : isError || !data ? (
        <p class="article-chart-note">Couldn't load this impact chart.</p>
      ) : (
        <ImpactBody data={data} />
      )}
      {caption && <figcaption class="article-chart-caption">{caption}</figcaption>}
    </figure>
  )
}
