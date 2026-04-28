/**
 * Food-items service: composes per-user food_items with central
 * shared_food_items so callers see one merged library.
 *
 * Read paths (search/get/getByName/findOrCreate) check central whenever the
 * per-user DB doesn't have the item. Write paths (upsert/update/delete)
 * stay confined to the per-user DB; central rows are managed exclusively
 * by the admin import flow (see services/imports/runner.ts).
 *
 * UUIDs are globally unique, so user-DB rows and central-DB rows never
 * collide; we don't need a namespace prefix on IDs.
 */

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import {
  findOrCreateFoodItem as findOrCreateUserFoodItem,
  getFoodItemById as getUserFoodItemById,
  getFoodItemByName as getUserFoodItemByName,
  type InsertFoodItemInput,
  searchFoodItems as searchUserFoodItems,
} from '../db/food-items.ts'

/**
 * `MergedFoodItem` is intentionally the union of user and central entity
 * types. Both have the same nutrient shape; the service just promises that
 * the row came from one of the two stores.
 */
export type MergedFoodItem = FoodItemEntity | SharedFoodItemEntity

export interface FoodItemsService {
  search: (user: string, q: string, limit?: number) => Promise<MergedFoodItem[]>
  getById: (user: string, id: string) => Promise<MergedFoodItem | null>
  getByName: (user: string, name: string) => Promise<MergedFoodItem | null>
  findOrCreate: (
    user: string,
    name: string,
    defaults?: Partial<InsertFoodItemInput>,
  ) => Promise<MergedFoodItem>
}

export const createFoodItemsService = (centralDb: CentralDb): FoodItemsService => ({
  search: async (user, q, limit = 20) => {
    const [userItems, sharedItems] = await Promise.all([
      searchUserFoodItems(user, q, limit),
      centralDb.searchSharedFoodItems(q, limit),
    ])
    // User items rank first — their own custom names + the LSV reference set
    // is the natural ordering. Limit applies to the combined list.
    return [...userItems, ...sharedItems].slice(0, limit)
  },

  getById: async (user, id) => {
    const fromUser = await getUserFoodItemById(user, id)
    if (fromUser) return fromUser
    return centralDb.getSharedFoodItemById(id)
  },

  getByName: async (user, name) => {
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return centralDb.getSharedFoodItemByName(name)
  },

  findOrCreate: async (user, name, defaults) => {
    // Prefer the central canonical entry over creating a per-user duplicate.
    // Exact name match only — fuzzy resolution would silently bind a meal to
    // the wrong food item.
    const central = await centralDb.getSharedFoodItemByName(name)
    if (central) return central
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return findOrCreateUserFoodItem(user, name, defaults)
  },
})
