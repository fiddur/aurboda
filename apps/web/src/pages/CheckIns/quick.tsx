import type { CheckIn, CheckInForm } from '@aurboda/api-spec'
import type { JSX } from 'preact'

import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { deleteCheckIn, submitCheckIn } from '../../state/api'
import { useRefreshCheckIns } from './queries'
import { UndoBar } from './UndoBar'

const LOGGED_UNDO_MS = 10_000

/** Saving a routine as preset (for a slot or not), or skipping a slot, in one tap. */
export type QuickAction =
  | { kind: 'confirm'; form: CheckInForm; slot?: string }
  | { kind: 'skip'; form_id: string; slot: string }

export interface Quick {
  run: (action: QuickAction) => void
  pending: QuickAction | undefined
}

export const sameAction = (a: QuickAction | undefined, b: QuickAction): boolean =>
  a !== undefined &&
  a.kind === b.kind &&
  (a.kind === 'confirm' ? a.form.id : a.form_id) === (b.kind === 'confirm' ? b.form.id : b.form_id) &&
  a.slot === b.slot

const submitAction = (action: QuickAction): Promise<CheckIn> =>
  action.kind === 'confirm'
    ? submitCheckIn({
        answers: {},
        form_id: action.form.id,
        use_defaults: true,
        ...(action.slot ? { scheduled_for: action.slot } : {}),
      })
    : submitCheckIn({ answers: {}, form_id: action.form_id, scheduled_for: action.slot, status: 'skipped' })

/**
 * One-tap check-ins with the ten-second "Logged … Undo" that follows them. Render `feedback` where
 * the undo bar and an error should show.
 */
export const useQuickCheckIn = (): { quick: Quick; feedback: JSX.Element | null } => {
  const refresh = useRefreshCheckIns()
  const [error, setError] = useState<string | null>(null)
  const [logged, setLogged] = useState<CheckIn | null>(null)
  const mutation = useMutation({
    mutationFn: submitAction,
    onError: (err) => setError(err.message),
    onSuccess: async (checkIn) => {
      setError(null)
      setLogged(checkIn)
      await refresh()
    },
  })
  useEffect(() => {
    if (!logged) return
    const timer = setTimeout(() => setLogged(null), LOGGED_UNDO_MS)
    return () => clearTimeout(timer)
  }, [logged])
  const quick: Quick = {
    pending: mutation.isPending ? mutation.variables : undefined,
    run: (action) => mutation.mutate(action),
  }
  const feedback =
    logged || error ? (
      <>
        {logged && (
          <UndoBar
            key={logged.id}
            message={`${logged.status === 'skipped' ? 'Skipped' : 'Logged'} ${logged.form_name}.`}
            onUndo={async () => {
              await deleteCheckIn(logged.id)
              await refresh()
            }}
            onClose={() => setLogged(null)}
          />
        )}
        {error && (
          <p class="checkin-error" role="alert">
            {error}
          </p>
        )}
      </>
    ) : null
  return { feedback, quick }
}
