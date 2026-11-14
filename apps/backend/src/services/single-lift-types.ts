import { getExerciseByKey, loadExerciseCatalog } from './exercise-catalog.ts'

/**
 * Early Health Connect alphas had these as exercise session types; current Health Connect has
 * them as segment types only. Aurboda stores such a lift as one set of a `strength_training`
 * session rather than as an activity type of its own.
 */
export interface SingleLiftType {
  display_name: string
  /** Built-in exercise catalogue key; null when no catalogue entry fits. */
  exercise_key: string | null
  health_connect_exercise_type: number
}

const lift = (
  display_name: string,
  exercise_key: string | null,
  health_connect_exercise_type: number,
): SingleLiftType => ({ display_name, exercise_key, health_connect_exercise_type })

export const singleLiftTypes: Record<string, SingleLiftType> = {
  back_extension: lift('Back Extension', 'hyperextensions_back_extensions', 1),
  barbell_shoulder_press: lift('Barbell Shoulder Press', 'barbell_shoulder_press', 3),
  bench_press: lift('Bench Press', 'bench_press', 6),
  bench_sit_up: lift('Bench Sit Up', 'sit_up', 7),
  burpee: lift('Burpee', 'burpee', 12),
  crunch: lift('Crunch', 'lying_ab_crunch', 15),
  deadlift: lift('Deadlift', 'deadlift', 17),
  dumbbell_curl_left_arm: lift('Dumbbell Curl Left Arm', 'dumbbell_biceps_curl', 18),
  dumbbell_curl_right_arm: lift('Dumbbell Curl Right Arm', 'dumbbell_biceps_curl', 19),
  dumbbell_front_raise: lift('Dumbbell Front Raise', 'front_dumbbell_raise', 20),
  dumbbell_lateral_raise: lift('Dumbbell Lateral Raise', 'standing_dumbbell_lateral_raise', 21),
  dumbbell_triceps_extension_left_arm: lift(
    'Dumbbell Triceps Extension Left Arm',
    'dumbbell_one_arm_triceps_extension',
    22,
  ),
  dumbbell_triceps_extension_right_arm: lift(
    'Dumbbell Triceps Extension Right Arm',
    'dumbbell_one_arm_triceps_extension',
    23,
  ),
  dumbbell_triceps_extension_two_arm: lift(
    'Dumbbell Triceps Extension Two Arm',
    'overhead_dumbbell_triceps_extension',
    24,
  ),
  forward_twist: lift('Forward Twist', null, 30),
  jumping_jack: lift('Jumping Jack', null, 40),
  lat_pull_down: lift('Lat Pull Down', 'lat_pulldown', 42),
  lunge: lift('Lunge', 'lunge', 43),
  plank: lift('Plank', 'plank', 49),
  squat: lift('Squat', 'squat', 67),
  upper_twist: lift('Upper Twist', null, 77),
}

export const singleLiftTypeNames = Object.keys(singleLiftTypes)

/** The catalogue entry's name, else the display name. */
export const singleLiftExerciseName = (
  typeName: string,
  catalog = loadExerciseCatalog(),
): string | undefined => {
  const type = singleLiftTypes[typeName]
  if (!type) return undefined
  const entry = type.exercise_key === null ? undefined : getExerciseByKey(catalog, type.exercise_key)
  return entry?.name ?? type.display_name
}

const typeNameByHealthConnect = new Map(
  Object.entries(singleLiftTypes).map(([name, type]) => [type.health_connect_exercise_type, name]),
)

export const singleLiftTypeForHealthConnect = (exerciseType: unknown): string | undefined =>
  typeof exerciseType === 'number' ? typeNameByHealthConnect.get(exerciseType) : undefined
