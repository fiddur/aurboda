import { exerciseMuscleGroupSchema, strengthScoreGroupSchema } from '@aurboda/api-spec'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const ratioSchema = z.number().positive()

const strengthReferencesFileSchema = z.object({
  bodyweight_exponent: z.number().positive(),
  groups: z.array(
    z.object({
      key: strengthScoreGroupSchema,
      muscle_groups: z.array(exerciseMuscleGroupSchema).min(1),
      name: z.string(),
    }),
  ),
  lifts: z.array(
    z.object({
      group: strengthScoreGroupSchema,
      id: z.string(),
      keys: z.array(z.string()).min(1),
      name: z.string(),
      ratio: z.object({ female: ratioSchema, male: ratioSchema }),
    }),
  ),
  reference_bodyweight_kg: z.number().positive(),
  version: z.number().int(),
})

type StrengthReferencesFile = z.infer<typeof strengthReferencesFileSchema>

export type StrengthReferenceGroup = StrengthReferencesFile['groups'][number]
export type StrengthReferenceLift = StrengthReferencesFile['lifts'][number]

export interface StrengthReferences extends StrengthReferencesFile {
  liftByCatalogKey: Map<string, StrengthReferenceLift>
}

/** The references with the lookup from a catalogue key to its lift. */
export const strengthReferencesOf = (file: StrengthReferencesFile): StrengthReferences => ({
  ...file,
  liftByCatalogKey: new Map(file.lifts.flatMap((lift) => lift.keys.map((key) => [key, lift] as const))),
})

let loaded: StrengthReferences | undefined

/** The built-in reference lifts, read and checked once on first use. */
export const loadStrengthReferences = (): StrengthReferences => {
  loaded ??= strengthReferencesOf(
    strengthReferencesFileSchema.parse(
      JSON.parse(
        readFileSync(new URL('../catalog/strength/strength-references.json', import.meta.url), 'utf8'),
      ),
    ),
  )
  return loaded
}
