import { type TrainingLoadSettings, trainingLoadInternalFields } from '@aurboda/api-spec'

/**
 * A client's `training_load` with the internal fields as stored: a client writes back the whole
 * object it read, and a stale copy must not undo a dirty mark, a lease or the computed range.
 */
export const withStoredInternalFields = (
  incoming: TrainingLoadSettings,
  stored: TrainingLoadSettings | undefined,
): TrainingLoadSettings => {
  const merged: Record<string, unknown> = { ...incoming }
  for (const field of trainingLoadInternalFields) {
    if (stored?.[field] === undefined) delete merged[field]
    else merged[field] = stored[field]
  }
  return merged as TrainingLoadSettings
}
