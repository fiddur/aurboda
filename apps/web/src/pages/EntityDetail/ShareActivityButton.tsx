/**
 * "Share to feed" affordance for an activity detail view. Opens the
 * {@link ShareActivityDialog} to publish the activity to the user's federated
 * feed. Activity-specific (unlike the generic {@link EntityActions}), so it
 * lives alongside the other activity-only actions.
 */
import { useState } from 'preact/hooks'

import { ShareActivityDialog } from '../../components/ShareActivityDialog'

export const ShareActivityButton = ({
  activityId,
  activityTitle,
  activityStart,
  activityEnd,
  chartMetrics,
  defaultMessage,
}: {
  activityId: string
  activityTitle?: string
  activityStart?: Date
  activityEnd?: Date
  chartMetrics?: string[]
  /** Prefill for the share message (the activity's description/comments). */
  defaultMessage?: string
}) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* Wrap in `.entity-actions` (like ResyncDetailButton) so the button sits
          compactly in an action row instead of stretching full-width as a bare
          flex child of the detail page column (#872). */}
      <div class="entity-actions">
        <button
          type="button"
          class="btn-secondary"
          onClick={() => setOpen(true)}
          title="Share this activity to your federated feed"
        >
          Share to feed
        </button>
      </div>
      {open && (
        <ShareActivityDialog
          activityId={activityId}
          activityTitle={activityTitle}
          activityStart={activityStart}
          activityEnd={activityEnd}
          chartMetrics={chartMetrics}
          defaultMessage={defaultMessage}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
