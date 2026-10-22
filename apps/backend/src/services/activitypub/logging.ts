import { configure, getConsoleSink, type LogLevel, type Sink } from '@logtape/logtape'

/**
 * Fedify logs through LogTape, which drops every record until a sink is configured.
 * Without one, an inbound activity whose HTTP signature fails to verify is a bare 401
 * with nothing in the container log (#919). The per-reason detail is at `debug`; the
 * failure itself is logged at `error`, so `warning` is enough to see it.
 *
 * `reset` lets this run more than once in a process (LogTape otherwise throws on a
 * second `configure`), so tests and restarts cannot trip on it.
 */
export const configureFederationLogging = (
  options: { lowestLevel?: LogLevel; sink?: Sink } = {},
): Promise<void> =>
  configure({
    loggers: [
      { category: ['fedify'], lowestLevel: options.lowestLevel ?? 'warning', sinks: ['console'] },
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: ['console'] },
    ],
    reset: true,
    sinks: { console: options.sink ?? getConsoleSink() },
  })
