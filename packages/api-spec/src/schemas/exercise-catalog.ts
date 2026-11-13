import { z } from 'zod'

import { createDataResponseSchema } from './common.ts'

export const exerciseMuscleGroups = [
  'chest',
  'shoulders',
  'traps',
  'lats',
  'middle_back',
  'lower_back',
  'biceps',
  'triceps',
  'forearms',
  'abdominals',
  'glutes',
  'abductors',
  'adductors',
  'quadriceps',
  'hamstrings',
  'calves',
  'neck',
] as const

export const exerciseMuscleGroupSchema = z.enum(exerciseMuscleGroups).meta({
  description: 'A muscle group of the exercise catalogue',
  id: 'ExerciseMuscleGroup',
})

export type ExerciseMuscleGroup = z.infer<typeof exerciseMuscleGroupSchema>

export const exerciseMuscles = [
  ...exerciseMuscleGroups,
  'wrist_flexors',
  'wrist_extensors',
  'lower_pecs',
  'upper_pecs',
  'front_delts',
  'side_delts',
  'rear_delts',
  'lower_traps',
  'middle_traps',
  'upper_traps',
  'triceps_medial_lateral',
  'triceps_long_head',
  'abs',
  'obliques',
  'spinal_erectors',
  'quads_vasti',
  'quads_rectus_femoris',
  'hamstrings_short_head',
  'glute_max',
  'glute_med',
  'gastrocnemius',
  'soleus',
] as const

export const exerciseMuscleSchema = z.enum(exerciseMuscles).meta({
  description:
    'A muscle of the exercise catalogue: a muscle group key (the group as a whole) or a finer muscle within a group',
  id: 'ExerciseMuscle',
})

export type ExerciseMuscle = z.infer<typeof exerciseMuscleSchema>

export const exerciseMuscleInfo: Record<ExerciseMuscle, { group: ExerciseMuscleGroup; name: string }> = {
  abdominals: { group: 'abdominals', name: 'Abdominals' },
  abductors: { group: 'abductors', name: 'Abductors' },
  abs: { group: 'abdominals', name: 'Abs (rectus abdominis)' },
  adductors: { group: 'adductors', name: 'Adductors' },
  biceps: { group: 'biceps', name: 'Biceps' },
  calves: { group: 'calves', name: 'Calves' },
  chest: { group: 'chest', name: 'Chest' },
  forearms: { group: 'forearms', name: 'Forearms' },
  front_delts: { group: 'shoulders', name: 'Front delts' },
  gastrocnemius: { group: 'calves', name: 'Gastrocnemius' },
  glute_max: { group: 'glutes', name: 'Gluteus maximus' },
  glute_med: { group: 'abductors', name: 'Gluteus medius' },
  glutes: { group: 'glutes', name: 'Glutes' },
  hamstrings: { group: 'hamstrings', name: 'Hamstrings' },
  hamstrings_short_head: { group: 'hamstrings', name: 'Hamstrings (short head)' },
  lats: { group: 'lats', name: 'Lats' },
  lower_back: { group: 'lower_back', name: 'Lower back' },
  lower_pecs: { group: 'chest', name: 'Lower pecs' },
  lower_traps: { group: 'traps', name: 'Lower traps' },
  middle_back: { group: 'middle_back', name: 'Middle back' },
  middle_traps: { group: 'traps', name: 'Middle traps' },
  neck: { group: 'neck', name: 'Neck' },
  obliques: { group: 'abdominals', name: 'Obliques' },
  quadriceps: { group: 'quadriceps', name: 'Quadriceps' },
  quads_rectus_femoris: { group: 'quadriceps', name: 'Quadriceps (rectus femoris)' },
  quads_vasti: { group: 'quadriceps', name: 'Quadriceps (vasti)' },
  rear_delts: { group: 'shoulders', name: 'Rear delts' },
  shoulders: { group: 'shoulders', name: 'Shoulders' },
  side_delts: { group: 'shoulders', name: 'Side delts' },
  soleus: { group: 'calves', name: 'Soleus' },
  spinal_erectors: { group: 'lower_back', name: 'Spinal erectors' },
  traps: { group: 'traps', name: 'Traps' },
  triceps: { group: 'triceps', name: 'Triceps' },
  triceps_long_head: { group: 'triceps', name: 'Triceps (long head)' },
  triceps_medial_lateral: { group: 'triceps', name: 'Triceps (medial and lateral heads)' },
  upper_pecs: { group: 'chest', name: 'Upper pecs' },
  upper_traps: { group: 'traps', name: 'Upper traps' },
  wrist_extensors: { group: 'forearms', name: 'Wrist extensors' },
  wrist_flexors: { group: 'forearms', name: 'Wrist flexors' },
}

export const exerciseEquipmentCategories = ['free_weights', 'machines', 'cables', 'other'] as const

export const exerciseEquipmentCategorySchema = z.enum(exerciseEquipmentCategories).meta({
  description: 'A kind of exercise equipment',
  id: 'ExerciseEquipmentCategory',
})

export type ExerciseEquipmentCategory = z.infer<typeof exerciseEquipmentCategorySchema>

export const exerciseEquipment = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'ez_bar',
  'plate',
  'cable',
  'dual_cable',
  'machine',
  'bands',
  'medicine_ball',
  'exercise_ball',
  'foam_roll',
  'trx',
  'gymnastic_rings',
  'other',
  'quad_blaster',
  'smith_machine_angled',
  'smith_machine_vertical',
  'shoulder_press_machine',
  'lateral_raise_machine',
  'chest_press_machine',
  'hammer_strength_chest_press',
  'pec_deck_machine',
  'chest_fly_machine',
  'rear_delt_fly_machine',
  'lat_pulldown_machine',
  'cable_row_machine',
  'row_machine',
  'preacher_curl_bench',
  'preacher_curl_machine',
  'bicep_curl_machine',
  'assisted_pull_up_machine',
  'assisted_dip_machine',
  'shrug_machine',
  'ab_crunch_machine',
  'hyper_45',
  'hyper_90',
  'hyper_reverse',
  'hip_thrust_machine',
  'glute_kickback_machine',
  'pendulum_glute_kickback',
  'hip_adduction_abduction_machine',
  'captains_chair',
  'glute_ham_raise',
  'belt_squat_machine',
  'hack_squat_machine',
  'squat_rack',
  'ham_curl_machine_lying',
  'ham_curl_machine_seated',
  'ham_curl_machine_standing',
  'leg_extension_machine',
  'leg_press_machine',
  'calf_raise_machine_seated',
  'calf_raise_machine_standing',
  'donkey_calf_raise_machine',
] as const

export const exerciseEquipmentSchema = z.enum(exerciseEquipment).meta({
  description: 'A piece of exercise equipment',
  id: 'ExerciseEquipment',
})

export type ExerciseEquipment = z.infer<typeof exerciseEquipmentSchema>

export const exerciseEquipmentInfo: Record<
  ExerciseEquipment,
  { category: ExerciseEquipmentCategory; name: string }
> = {
  ab_crunch_machine: { category: 'machines', name: 'Ab Crunch Machine' },
  assisted_dip_machine: { category: 'machines', name: 'Assisted Dip Machine' },
  assisted_pull_up_machine: { category: 'machines', name: 'Assisted Pull-up Machine' },
  bands: { category: 'other', name: 'Resistance bands' },
  barbell: { category: 'free_weights', name: 'Barbell' },
  belt_squat_machine: { category: 'machines', name: 'Belt Squat Machine' },
  bicep_curl_machine: { category: 'machines', name: 'Biceps Curl Machine' },
  cable: { category: 'cables', name: 'Cable' },
  cable_row_machine: { category: 'machines', name: 'Cable Row Machine' },
  calf_raise_machine_seated: { category: 'machines', name: 'Seated Calf Raise Machine' },
  calf_raise_machine_standing: { category: 'machines', name: 'Standing Calf Raise Machine' },
  captains_chair: { category: 'other', name: "Captain's Chair" },
  chest_fly_machine: { category: 'machines', name: 'Chest Fly Machine (hand grips)' },
  chest_press_machine: { category: 'machines', name: 'Chest Press Machine' },
  donkey_calf_raise_machine: { category: 'machines', name: 'Donkey Calf Raise Machine' },
  dual_cable: { category: 'cables', name: 'Dual cable' },
  dumbbell: { category: 'free_weights', name: 'Dumbbell' },
  exercise_ball: { category: 'other', name: 'Exercise ball' },
  ez_bar: { category: 'free_weights', name: 'EZ bar' },
  foam_roll: { category: 'other', name: 'Foam roll' },
  glute_ham_raise: { category: 'machines', name: 'Glute-Ham raise' },
  glute_kickback_machine: { category: 'machines', name: 'Glute Kickback Machine' },
  gymnastic_rings: { category: 'other', name: 'Gymnastic rings' },
  hack_squat_machine: { category: 'machines', name: 'Hack Squat Machine' },
  ham_curl_machine_lying: { category: 'machines', name: 'Lying Leg Curl Machine' },
  ham_curl_machine_seated: { category: 'machines', name: 'Seated Leg Curl Machine' },
  ham_curl_machine_standing: { category: 'machines', name: 'Standing Leg Curl Machine' },
  hammer_strength_chest_press: { category: 'machines', name: 'Hammer Strength Chest Press' },
  hip_adduction_abduction_machine: { category: 'machines', name: 'Hip (Add/Abd)uction Machine' },
  hip_thrust_machine: { category: 'machines', name: 'Hip Thrust Machine' },
  hyper_45: { category: 'machines', name: '45° Back Extension' },
  hyper_90: { category: 'machines', name: '90° Back Extension' },
  hyper_reverse: { category: 'machines', name: 'Reverse Hyper' },
  kettlebell: { category: 'free_weights', name: 'Kettlebell' },
  lat_pulldown_machine: { category: 'machines', name: 'Lat Pulldown Machine' },
  lateral_raise_machine: { category: 'machines', name: 'Lateral Raise Machine' },
  leg_extension_machine: { category: 'machines', name: 'Leg Extension Machine' },
  leg_press_machine: { category: 'machines', name: 'Leg Press Machine' },
  machine: { category: 'machines', name: 'Machine' },
  medicine_ball: { category: 'other', name: 'Medicine ball' },
  other: { category: 'other', name: 'Other' },
  pec_deck_machine: { category: 'machines', name: 'Pec Deck (elbow pad)' },
  pendulum_glute_kickback: { category: 'machines', name: 'Pendulum Kickback' },
  plate: { category: 'free_weights', name: 'Weight plates' },
  preacher_curl_bench: { category: 'other', name: 'Preacher Curl Bench' },
  preacher_curl_machine: { category: 'machines', name: 'Preacher Curl Machine' },
  quad_blaster: { category: 'other', name: 'Quad Blaster' },
  rear_delt_fly_machine: { category: 'machines', name: 'Rear Delt Fly Machine' },
  row_machine: { category: 'machines', name: 'Row Machine (chest supported)' },
  shoulder_press_machine: { category: 'machines', name: 'Shoulder Press Machine' },
  shrug_machine: { category: 'machines', name: 'Shrug Machine' },
  smith_machine_angled: { category: 'machines', name: 'Smith Machine angled' },
  smith_machine_vertical: { category: 'machines', name: 'Smith Machine vertical' },
  squat_rack: { category: 'other', name: 'Squat rack/cage' },
  trx: { category: 'other', name: 'TRX' },
}

export const exerciseCategories = ['strength', 'stretching', 'plyometrics'] as const

export const exerciseCategorySchema = z.enum(exerciseCategories).meta({
  description: 'The kind of exercise',
  id: 'ExerciseCategory',
})

export type ExerciseCategory = z.infer<typeof exerciseCategorySchema>

export const exerciseCatalogKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .meta({
    description: 'Stable identifier of a catalogue exercise: never renamed, never reused',
    example: 'dumbbell_bench_press',
  })

export const exerciseCatalogSameAsSchema = z
  .object({
    bodybuild: z.string().optional().meta({ description: 'The body.build exercise id' }),
    fit: z.string().optional().meta({ description: 'The Garmin FIT exercise, `<category>/<name>`' }),
    free_exercise_db: z.string().optional().meta({ description: 'The free-exercise-db exercise id' }),
    wikidata: z.string().optional().meta({ description: 'The Wikidata item id (Q…)' }),
  })
  .meta({ description: 'The same exercise in other datasets', id: 'ExerciseCatalogSameAs' })

export type ExerciseCatalogSameAs = z.infer<typeof exerciseCatalogSameAsSchema>

const recruitmentWeightSchema = z.number().gt(0).lte(1)

export const storedExerciseCatalogEntrySchema = z
  .object({
    aliases: z.array(z.string()),
    category: exerciseCategorySchema,
    equipment: z.array(exerciseEquipmentSchema),
    key: exerciseCatalogKeySchema,
    muscles: z.partialRecord(exerciseMuscleSchema, recruitmentWeightSchema),
    name: z.string().min(1),
    same_as: exerciseCatalogSameAsSchema,
    search_terms: z.array(z.string()),
  })
  .refine((entry) => entry.same_as.bodybuild !== undefined || entry.same_as.free_exercise_db !== undefined, {
    message: 'An entry comes from body.build, free-exercise-db or both',
  })
  .meta({
    description: 'An exercise as stored in the built catalogue file',
    id: 'StoredExerciseCatalogEntry',
  })

export type StoredExerciseCatalogEntry = z.infer<typeof storedExerciseCatalogEntrySchema>

const catalogSourceSchema = z.object({ commit: z.string(), license: z.string(), url: z.string() })

export const storedExerciseCatalogSchema = z
  .object({
    entries: z.array(storedExerciseCatalogEntrySchema),
    sources: z.object({ bodybuild: catalogSourceSchema, free_exercise_db: catalogSourceSchema }),
    version: z.string(),
  })
  .meta({ description: 'The built exercise catalogue file', id: 'StoredExerciseCatalog' })

export type StoredExerciseCatalog = z.infer<typeof storedExerciseCatalogSchema>

export const exerciseCatalogEquipmentSchema = z
  .object({
    category: exerciseEquipmentCategorySchema,
    key: exerciseEquipmentSchema,
    name: z.string().meta({ description: 'Display name' }),
  })
  .meta({ description: 'A piece of equipment an exercise uses', id: 'ExerciseCatalogEquipment' })

export type ExerciseCatalogEquipment = z.infer<typeof exerciseCatalogEquipmentSchema>

export const exerciseCatalogMuscleSchema = z
  .object({
    group: exerciseMuscleGroupSchema,
    key: exerciseMuscleSchema,
    name: z.string().meta({ description: 'Display name' }),
    weight: recruitmentWeightSchema.meta({
      description: 'How much the exercise recruits the muscle, in (0, 1]: 1 fully, 0.5 as a secondary mover',
    }),
  })
  .meta({
    description: 'A muscle an exercise works, with its recruitment weight',
    id: 'ExerciseCatalogMuscle',
  })

export type ExerciseCatalogMuscle = z.infer<typeof exerciseCatalogMuscleSchema>

export const exerciseCatalogEntrySchema = z
  .object({
    aliases: z.array(z.string()).meta({ description: 'Other names that identify exactly this exercise' }),
    category: exerciseCategorySchema,
    equipment: z.array(exerciseCatalogEquipmentSchema),
    key: exerciseCatalogKeySchema,
    muscles: z
      .array(exerciseCatalogMuscleSchema)
      .meta({ description: 'Muscles worked, by recruitment weight (highest first), then key' }),
    name: z.string().meta({ description: 'Display name' }),
    same_as: exerciseCatalogSameAsSchema,
  })
  .meta({ description: 'An exercise of the built-in catalogue', id: 'ExerciseCatalogEntry' })

export type ExerciseCatalogEntry = z.infer<typeof exerciseCatalogEntrySchema>

export const exerciseCatalogQuerySchema = z
  .object({
    category: exerciseCategorySchema.optional().meta({ description: 'Only exercises of this category' }),
    equipment: exerciseEquipmentSchema
      .optional()
      .meta({ description: 'Only exercises using this equipment' }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .meta({ description: 'Max entries to return (1–100, default 20)' }),
    muscle: exerciseMuscleSchema.optional().meta({
      description:
        'Only exercises that work this muscle, or a muscle of this group, at a recruitment weight of at least 0.5',
    }),
    name: z.string().optional().meta({
      description:
        'Exact name or alias, ignoring case and punctuation: returns that exercise or none, and ignores q',
    }),
    offset: z.coerce.number().int().min(0).default(0).meta({ description: 'Entries to skip (default 0)' }),
    q: z.string().optional().meta({
      description:
        'Search words: each must be the start of a word of the name, an alias or a search term. Best matches first',
    }),
  })
  .meta({ description: 'Search the exercise catalogue', id: 'ExerciseCatalogQuery' })

export type ExerciseCatalogQuery = z.infer<typeof exerciseCatalogQuerySchema>

export const exerciseCatalogSearchResultSchema = z
  .object({
    entries: z.array(exerciseCatalogEntrySchema),
    total: z.number().int().meta({ description: 'Entries matching, before limit and offset' }),
    version: z.string().meta({ description: 'Catalogue version' }),
  })
  .meta({ description: 'A page of matching catalogue exercises', id: 'ExerciseCatalogSearchResult' })

export type ExerciseCatalogSearchResult = z.infer<typeof exerciseCatalogSearchResultSchema>

export const exerciseCatalogSearchResponseSchema = createDataResponseSchema(
  exerciseCatalogSearchResultSchema,
).meta({ id: 'ExerciseCatalogSearchResponse' })

export type ExerciseCatalogSearchResponse = z.infer<typeof exerciseCatalogSearchResponseSchema>

export const exerciseCatalogEntryResultSchema = z
  .object({
    entry: exerciseCatalogEntrySchema,
    version: z.string().meta({ description: 'Catalogue version' }),
  })
  .meta({ description: 'One catalogue exercise', id: 'ExerciseCatalogEntryResult' })

export type ExerciseCatalogEntryResult = z.infer<typeof exerciseCatalogEntryResultSchema>

export const exerciseCatalogEntryResponseSchema = createDataResponseSchema(
  exerciseCatalogEntryResultSchema,
).meta({ id: 'ExerciseCatalogEntryResponse' })

export type ExerciseCatalogEntryResponse = z.infer<typeof exerciseCatalogEntryResponseSchema>
