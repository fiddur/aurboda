import { runCategoryFilterSchema } from '@aurboda/api-spec'

/** Lower-cases and snake_cases free text into a run category name; null when nothing valid is left. */
export const normalizeCategoryName = (input: string): string | null => {
  const name = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  return runCategoryFilterSchema.safeParse(name).success ? name : null
}
