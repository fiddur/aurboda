/**
 * Restore (undo soft-delete) and additional delete-by-id services.
 */

import {
  deleteProductivityRecord as dbDeleteProductivityRecord,
  deleteTagById as dbDeleteTagById,
  restoreActivity as dbRestoreActivity,
  restoreProductivityRecord as dbRestoreProductivityRecord,
  restoreTag as dbRestoreTag,
} from '../db'
import type { DeleteActivityResult, DeleteTagResult } from './mutations'

export interface RestoreResult {
  success: boolean
  restored: boolean
  id: string
}

export async function restoreActivity(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreActivity(user, id)
  return { id, restored, success: restored }
}

export async function restoreTag(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreTag(user, id)
  return { id, restored, success: restored }
}

export async function restoreProductivity(user: string, id: string): Promise<RestoreResult> {
  const restored = await dbRestoreProductivityRecord(user, id)
  return { id, restored, success: restored }
}

export async function deleteTagById(user: string, id: string): Promise<DeleteTagResult> {
  const deleted = await dbDeleteTagById(user, id)
  return { deleted, external_id: id, success: deleted }
}

export async function deleteProductivity(user: string, id: string): Promise<DeleteActivityResult> {
  const deleted = await dbDeleteProductivityRecord(user, id)
  return { deleted, id, success: deleted }
}
