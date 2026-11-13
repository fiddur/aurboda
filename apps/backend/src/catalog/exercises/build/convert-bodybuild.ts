import type { ExerciseEquipment, ExerciseMuscle } from '@aurboda/api-spec'

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type DartNode, parseDart, printDart } from './dart-reader.ts'
import { formatJson } from './json.ts'
import { type Assignment, createRecruitmentResolver } from './recruitment.ts'

export const BODYBUILD_SOURCE = {
  commit: '4d8bbcc5ccea4d6802ee373a0be1aa5f5dcc8dd6',
  license: 'AGPL-3.0',
  url: 'https://github.com/Dieterbe/body.build',
} as const

export const programGroupMuscles: Record<string, ExerciseMuscle> = {
  abs: 'abs',
  biceps: 'biceps',
  frontDelts: 'front_delts',
  gastroc: 'gastrocnemius',
  gluteMax: 'glute_max',
  gluteMed: 'glute_med',
  hams: 'hamstrings',
  hamsShortHead: 'hamstrings_short_head',
  lats: 'lats',
  lowerPecs: 'lower_pecs',
  lowerTraps: 'lower_traps',
  middleTraps: 'middle_traps',
  obliques: 'obliques',
  quadsRF: 'quads_rectus_femoris',
  quadsVasti: 'quads_vasti',
  rearDelts: 'rear_delts',
  sideDelts: 'side_delts',
  soleus: 'soleus',
  spinalErectors: 'spinal_erectors',
  tricepsLongHead: 'triceps_long_head',
  tricepsMedLatH: 'triceps_medial_lateral',
  upperPecs: 'upper_pecs',
  upperTraps: 'upper_traps',
  wristExtensors: 'wrist_extensors',
  wristFlexors: 'wrist_flexors',
}

export const bodybuildEquipment: Record<string, ExerciseEquipment> = {
  abCrunchMachine: 'ab_crunch_machine',
  assistedDipMachine: 'assisted_dip_machine',
  assistedPullUpMachine: 'assisted_pull_up_machine',
  barbell: 'barbell',
  beltSquatMachine: 'belt_squat_machine',
  bicepCurlMachine: 'bicep_curl_machine',
  cableRowMachine: 'cable_row_machine',
  cableTower: 'cable',
  cableTowerDual: 'dual_cable',
  calfRaiseMachineSeated: 'calf_raise_machine_seated',
  calfRaiseMachineStanding: 'calf_raise_machine_standing',
  captainsChair: 'captains_chair',
  chestFlyMachine: 'chest_fly_machine',
  chestPressMachine: 'chest_press_machine',
  donkeyCalfRaiseMachine: 'donkey_calf_raise_machine',
  dumbbell: 'dumbbell',
  elastic: 'bands',
  ezbar: 'ez_bar',
  gluteHamRaise: 'glute_ham_raise',
  gluteKickbackMachine: 'glute_kickback_machine',
  gymnasticRings: 'gymnastic_rings',
  hackSquatMachine: 'hack_squat_machine',
  hamCurlMachineLying: 'ham_curl_machine_lying',
  hamCurlMachineSeated: 'ham_curl_machine_seated',
  hamCurlMachineStanding: 'ham_curl_machine_standing',
  hammerStrengthChestPress: 'hammer_strength_chest_press',
  hipAdductionAbductionMachine: 'hip_adduction_abduction_machine',
  hipThrustMachine: 'hip_thrust_machine',
  hyper45: 'hyper_45',
  hyper90: 'hyper_90',
  hyperReverse: 'hyper_reverse',
  kettlebell: 'kettlebell',
  lateralRaiseMachine: 'lateral_raise_machine',
  latPullDownMachine: 'lat_pulldown_machine',
  legExtensionMachine: 'leg_extension_machine',
  legPressMachine: 'leg_press_machine',
  pecDeckMachine: 'pec_deck_machine',
  pendulumGluteKickback: 'pendulum_glute_kickback',
  plate: 'plate',
  preacherCurlBench: 'preacher_curl_bench',
  preacherCurlMachine: 'preacher_curl_machine',
  quadBlaster: 'quad_blaster',
  rearDeltFlyMachine: 'rear_delt_fly_machine',
  rowMachine: 'row_machine',
  shoulderPressMachine: 'shoulder_press_machine',
  shrugMachine: 'shrug_machine',
  smithMachineAngled: 'smith_machine_angled',
  smithMachineVertical: 'smith_machine_vertical',
  squatRack: 'squat_rack',
  trx: 'trx',
}

export const FIRST_CARDIO_EXERCISE = 'cycling'
export const EXPECTED_EXERCISES = 172
export const EXPECTED_STRENGTH_EXERCISES = 157
export const EXPECTED_PROGRAM_GROUPS = 25

export interface BodybuildExercise {
  equipment: ExerciseEquipment[]
  id: string
  muscles: Partial<Record<ExerciseMuscle, number>>
  search_aliases: string[]
}

export interface BodybuildSourceFile {
  entries: BodybuildExercise[]
  source: typeof BODYBUILD_SOURCE
}

const stringList = (node: DartNode | undefined, what: string): string[] => {
  if (!node) return []
  if (node.kind !== 'list') throw new Error(`Expected a list of ${what}, got ${printDart(node)}`)
  return node.items.map((item) => {
    if ('spread' in item || item.value.kind !== 'str') {
      throw new Error(
        `Expected a string in ${what}, got ${printDart('spread' in item ? item.spread : item.value)}`,
      )
    }
    return item.value.value
  })
}

const equipmentList = (node: DartNode | undefined): ExerciseEquipment[] => {
  if (!node || node.kind !== 'list') {
    throw new Error(`Expected an equipment list, got ${node && printDart(node)}`)
  }
  return node.items.map((item) => {
    const value = 'value' in item ? item.value : item.spread
    const mapped =
      'value' in item &&
      value.kind === 'member' &&
      value.target.kind === 'ref' &&
      value.target.name === 'Equipment'
        ? bodybuildEquipment[value.name]
        : undefined
    if (!mapped) throw new Error(`Unresolved equipment: ${printDart(value)}`)
    return mapped
  })
}

const toMuscles = (assignment: Assignment): Partial<Record<ExerciseMuscle, number>> => {
  const muscles: Partial<Record<ExerciseMuscle, number>> = {}
  for (const [group, weight] of assignment) {
    const muscle = programGroupMuscles[group]
    if (!muscle) throw new Error(`Unknown program group: ${group}`)
    if (weight > 0) muscles[muscle] = weight
  }
  return muscles
}

export interface DartSources {
  equipment: string
  ex: string
  programGroup: string
  tweak: string
  volumeAssignment: string
}

export interface RecruitmentSources {
  tweak: string
  volumeAssignment: string
}

const mergeDeclarations = (...maps: Map<string, DartNode>[]): Map<string, DartNode> => {
  const out = new Map<string, DartNode>()
  for (const map of maps) {
    for (const [name, node] of map) {
      if (out.has(name)) throw new Error(`Duplicate declaration: ${name}`)
      out.set(name, node)
    }
  }
  return out
}

export const createResolver = ({ tweak, volumeAssignment }: RecruitmentSources) => {
  const tweaks = parseDart(tweak)
  return createRecruitmentResolver({
    declarations: mergeDeclarations(parseDart(volumeAssignment).declarations(), tweaks.declarations()),
    functions: tweaks.functions(),
  })
}

export const assertEnumCoverage = (actual: string[], mapping: Record<string, unknown>, name: string) => {
  const missing = actual.filter((value) => !(value in mapping))
  const extra = Object.keys(mapping).filter((value) => !actual.includes(value))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${name} mapping out of date: unmapped [${missing.join(', ')}], unknown [${extra.join(', ')}]`,
    )
  }
}

export const readExercises = (exSource: string, recruitment: RecruitmentSources): BodybuildExercise[] => {
  const resolver = createResolver(recruitment)
  const list = parseDart(exSource).assignment('exes')
  if (list.kind !== 'list') throw new Error('`exes` is not a list literal')
  return list.items.map((item) => {
    const call = 'value' in item ? item.value : undefined
    if (!call || call.kind !== 'call' || call.callee.kind !== 'ref' || call.callee.name !== 'Ex') {
      throw new Error(`Expected Ex(…) in exes, got ${printDart('value' in item ? item.value : item.spread)}`)
    }
    const positional = call.args.filter((a) => !a.name).map((a) => a.value)
    const [va, id, equipment, tweaks] = positional
    if (!va || id?.kind !== 'str') throw new Error(`Malformed Ex(…): ${printDart(call).slice(0, 120)}`)
    return {
      equipment: equipmentList(equipment),
      id: id.value,
      muscles: toMuscles(resolver.recruitment(va, tweaks)),
      search_aliases: stringList(positional[5], `searchAliases of ${id.value}`),
    }
  })
}

export const convertBodybuild = (sources: DartSources): BodybuildSourceFile => {
  const groups = parseDart(sources.programGroup).enumValues('ProgramGroup')
  if (groups.length !== EXPECTED_PROGRAM_GROUPS) {
    throw new Error(`Expected ${EXPECTED_PROGRAM_GROUPS} program groups, found ${groups.length}`)
  }
  assertEnumCoverage(groups, programGroupMuscles, 'ProgramGroup')
  assertEnumCoverage(parseDart(sources.equipment).enumValues('Equipment'), bodybuildEquipment, 'Equipment')

  const all = readExercises(sources.ex, sources)
  if (all.length !== EXPECTED_EXERCISES) {
    throw new Error(`Expected ${EXPECTED_EXERCISES} Ex entries, found ${all.length}`)
  }
  const cardioAt = all.findIndex((e) => e.id === FIRST_CARDIO_EXERCISE)
  if (cardioAt === -1) throw new Error(`No '${FIRST_CARDIO_EXERCISE}' exercise to start the cardio block`)
  const entries = all.slice(0, cardioAt)
  if (entries.length !== EXPECTED_STRENGTH_EXERCISES) {
    throw new Error(
      `Expected ${EXPECTED_STRENGTH_EXERCISES} exercises before the cardio block, found ${entries.length}`,
    )
  }
  return { entries, source: BODYBUILD_SOURCE }
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (!dir) {
    throw new Error('Usage: node convert-bodybuild.ts <directory with the body.build dataset .dart files>')
  }
  const read = (file: string) => readFileSync(join(dir, file), 'utf8')
  const result = convertBodybuild({
    equipment: read('equipment.dart'),
    ex: read('ex.dart'),
    programGroup: read('program_group.dart'),
    tweak: read('tweak.dart'),
    volumeAssignment: read('volume_assignment.dart'),
  })
  writeFileSync(new URL('../sources/bodybuild.json', import.meta.url), formatJson(result))
  console.info(`Wrote ${result.entries.length} body.build exercises`)
}
