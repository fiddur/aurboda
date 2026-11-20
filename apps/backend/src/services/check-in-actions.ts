import { isCheckInRoutine } from '@aurboda/api-spec'

import type { NotificationRecord } from '../db/index.ts'
import type { NotificationActionHandler, NotificationActionResult } from './notification-actions.ts'

import { type CheckInDeps, formSlotAt, type Outcome, submitCheckIn } from './check-ins.ts'

const localTime = (instant: Date, timezone: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' })

const conflict = (
  notification: NotificationRecord,
  message: string,
  body: string,
): NotificationActionResult => ({
  message,
  ok: false,
  revision: { body, title: notification.title },
})

const slotOf = (notification: NotificationRecord): { form_id: string; scheduled_for: string } | null => {
  const formId = notification.data?.form_id
  const scheduledFor = notification.data?.scheduled_for
  return typeof formId === 'string' && typeof scheduledFor === 'string'
    ? { form_id: formId, scheduled_for: scheduledFor }
    : null
}

const outcomeResult = (
  notification: NotificationRecord,
  outcome: Outcome<unknown>,
  body: string,
): NotificationActionResult =>
  outcome.ok
    ? { ok: true, revision: { body, title: notification.title } }
    : conflict(notification, outcome.error, outcome.error)

/**
 * The `done` and `skip` actions of a routine's `check_in_due` notification. Done saves the routine
 * as preset at the time pressed, for the notification's slot; Skip records the slot as skipped. Both
 * answer a conflict when the form is gone, the slot is already done or skipped, or (for Done) the
 * form is no longer a routine.
 */
export const checkInDueActionHandlers = (deps: CheckInDeps): Record<string, NotificationActionHandler> => {
  const guard = async (
    user: string,
    notification: NotificationRecord,
    needsRoutine: boolean,
  ): Promise<NotificationActionResult | { form_id: string; scheduled_for: string }> => {
    const slot = slotOf(notification)
    if (!slot) return { message: 'This notification names no check-in slot', ok: false }
    const form = await deps.getForm(user, slot.form_id)
    if (!form || form.deleted_at) {
      return conflict(notification, 'The check-in form was deleted', 'The form was deleted')
    }
    if (needsRoutine && !isCheckInRoutine(form.questions)) {
      return conflict(
        notification,
        'The form is no longer a routine: a required question has no default',
        'The form changed: open it to fill it in',
      )
    }
    const state = await formSlotAt(deps, user, form, new Date(slot.scheduled_for))
    if (!state) return conflict(notification, 'This slot is no longer in the schedule', 'No longer scheduled')
    if (state.state === 'done') return conflict(notification, 'This slot is already done', 'Already done')
    if (state.state === 'skipped') {
      return conflict(notification, 'This slot is already skipped', 'Already skipped')
    }
    return slot
  }

  return {
    done: async (user, notification) => {
      const guarded = await guard(user, notification, true)
      if ('ok' in guarded) return guarded
      const now = deps.now()
      const outcome = await submitCheckIn(deps, user, {
        answered_at: now.toISOString(),
        answers: {},
        form_id: guarded.form_id,
        scheduled_for: guarded.scheduled_for,
        use_defaults: true,
      })
      return outcomeResult(notification, outcome, `Done at ${localTime(now, await deps.getTimezone(user))}`)
    },
    skip: async (user, notification) => {
      const guarded = await guard(user, notification, false)
      if ('ok' in guarded) return guarded
      const outcome = await submitCheckIn(deps, user, {
        answers: {},
        form_id: guarded.form_id,
        scheduled_for: guarded.scheduled_for,
        status: 'skipped',
      })
      return outcomeResult(notification, outcome, 'Skipped')
    },
  }
}
