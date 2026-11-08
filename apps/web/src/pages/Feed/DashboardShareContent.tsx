/**
 * Native card for a dashboard-period share post: the shared period's widgets drawn from the
 * structured payload (the config snapshot and each widget's data for the period). The owner's feed,
 * the public profile and a peer's timeline all render it, so the note goes through
 * `renderRemoteMarkdown` everywhere.
 */
import type { DashboardShare, FeedStructuredDashboardShare, SectionType } from '@aurboda/api-spec'

import { periodLabel } from '@aurboda/api-spec'

import { PublicWidgetRenderer } from '../../components/widgets'
import { httpLink } from '../../utils/http-link'
import { renderRemoteMarkdown } from '../../utils/markdown'
import '../Dashboard/style.css'
import './FeedPostCard.css'
import './TimelineStructured.css'
import './DashboardShareContent.css'

const gridClass = (type: SectionType): string =>
  type === 'links' ? 'links-grid' : type === 'charts' ? 'charts-grid' : 'metrics-grid'

const DashboardTitle = ({ name, period, url }: { name: string; period: string; url?: string }) => {
  const link = httpLink(url)
  return (
    <>
      <p class="feed-post-title">
        <strong>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          ) : (
            name
          )}
        </strong>
      </p>
      <p class="timeline-dashboard-share-period">{periodLabel(period)}</p>
    </>
  )
}

const Message = ({ message }: { message?: string | null }) =>
  message ? <div dangerouslySetInnerHTML={{ __html: renderRemoteMarkdown(message) }} /> : null

export const DashboardShareContent = ({ structured }: { structured: FeedStructuredDashboardShare }) => {
  const shownPeriod = periodLabel(structured.period)
  const sections = structured.config.sections
    .map((section) => ({ ...section, widgets: section.widgets.filter((w) => w.type !== 'quick_link') }))
    .filter((section) => section.widgets.length > 0)

  return (
    <div class="timeline-structured timeline-dashboard-share">
      <DashboardTitle name={structured.name} period={structured.period} url={structured.url} />
      <Message message={structured.message} />
      <div class="dashboard timeline-dashboard-share-board">
        {sections.map((section) => (
          <section key={section.id} class="metrics-section">
            <p class="timeline-dashboard-share-heading">{section.title}</p>
            <div class={gridClass(section.type)}>
              {section.widgets.map((widget) => (
                <PublicWidgetRenderer
                  key={widget.id}
                  widget={widget}
                  data={structured.widget_data[widget.id]}
                  periodLabel={shownPeriod}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** A dashboard post whose payload could not be resolved: its name, period, note and link only. */
export const DashboardShareFallback = ({
  dashboard,
  message,
}: {
  dashboard: DashboardShare
  message?: string | null
}) => (
  <div class="timeline-structured timeline-dashboard-share">
    <DashboardTitle name={dashboard.name} period={dashboard.period} url={dashboard.url} />
    <Message message={message} />
  </div>
)
