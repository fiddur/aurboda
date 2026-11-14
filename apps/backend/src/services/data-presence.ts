import type { DataPresence, DataPresenceQuery } from '@aurboda/api-spec'

import { getDataPresence } from '../db/index.ts'

export const parseNameList = (raw: string | undefined): string[] => [
  ...new Set(
    (raw ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  ),
]

export const queryDataPresence = (
  user: string,
  { activity_types, metrics }: DataPresenceQuery,
): Promise<DataPresence> => getDataPresence(user, parseNameList(metrics), parseNameList(activity_types))
