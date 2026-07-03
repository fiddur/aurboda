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
}: {
  activityId: string
  activityTitle?: string
  activityStart?: Date
  activityEnd?: Date
}) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        class="btn-secondary"
        onClick={() => setOpen(true)}
        title="Share this activity to your federated feed"
      >
        Share to feed
      </button>
      {open && (
        <ShareActivityDialog
          activityId={activityId}
          activityTitle={activityTitle}
          activityStart={activityStart}
          activityEnd={activityEnd}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
