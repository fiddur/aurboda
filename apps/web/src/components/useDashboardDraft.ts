import type { DashboardConfig } from '@aurboda/api-spec'

import { useMemo, useRef, useState } from 'preact/hooks'

import { createLatestWinsSaver, type LatestWinsSaver } from './latestWinsSaver'

export interface DashboardDraft {
  /** The edited config not yet saved, ahead of the cached one; null when nothing is pending. */
  config: DashboardConfig | null
  submit: (config: DashboardConfig) => void
  clear: () => void
}

interface DraftHandlers<R> {
  onSaved: (key: string, result: R) => Promise<void> | void
  onError: (key: string, error: unknown) => void
}

/**
 * Edits of the dashboard `key` (home or a shared-dashboard id), saved one at a time with only the latest
 * waiting. The draft is shown and edited on until the last save lands and `onSaved` has updated the cache,
 * so an edit never builds on a config that a pending save or a stale refetch left behind.
 */
export const useDashboardDraft = <R>(
  key: string,
  save: (key: string, config: DashboardConfig) => Promise<R>,
  handlers: DraftHandlers<R>,
): DashboardDraft => {
  const [draft, setDraft] = useState<{ key: string; config: DashboardConfig } | null>(null)
  const latest = useRef({ handlers, save })
  latest.current = { handlers, save }

  const saver = useMemo(() => {
    const clearIfIdle = (s: LatestWinsSaver<DashboardConfig>) =>
      setDraft((d) => (d?.key === key && !s.isBusy() ? null : d))
    const created: LatestWinsSaver<DashboardConfig> = createLatestWinsSaver(
      (config: DashboardConfig) => latest.current.save(key, config),
      {
        onError: (error) => {
          clearIfIdle(created)
          latest.current.handlers.onError(key, error)
        },
        onIdle: (result) => {
          void Promise.resolve(latest.current.handlers.onSaved(key, result)).then(
            () => clearIfIdle(created),
            (error: unknown) => {
              clearIfIdle(created)
              latest.current.handlers.onError(key, error)
            },
          )
        },
      },
    )
    return created
  }, [key])

  return {
    clear: () => setDraft(null),
    config: draft?.key === key ? draft.config : null,
    submit: (config) => {
      setDraft({ config, key })
      saver.submit(config)
    },
  }
}
