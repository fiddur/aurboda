/**
 * Maps Strava sport_type values to Aurboda activity type names.
 *
 * Aurboda uses snake_case identifiers that align with Health Connect exercise types.
 * Unmapped Strava types will be auto-converted to snake_case and created on the fly
 * via resolveOrCreateActivityType.
 */

export const stravaSportTypeMap: Record<string, string> = {
  // Running
  Run: 'running',
  TrailRun: 'running',
  VirtualRun: 'running_treadmill',

  // Cycling
  Ride: 'biking',
  MountainBikeRide: 'biking',
  GravelRide: 'biking',
  VirtualRide: 'biking_stationary',
  EBikeRide: 'biking',
  EMountainBikeRide: 'biking',
  Handcycle: 'biking',
  Velomobile: 'biking',

  // Swimming
  Swim: 'swimming_pool',

  // Walking / Hiking
  Walk: 'walking',
  Hike: 'hiking',

  // Winter sports
  AlpineSki: 'skiing_downhill',
  BackcountrySki: 'skiing_cross_country',
  NordicSki: 'skiing_cross_country',
  Snowboard: 'snowboarding',
  Snowshoe: 'snowshoeing',
  IceSkate: 'ice_skating',

  // Water sports
  Rowing: 'rowing',
  Kayaking: 'kayaking',
  Canoeing: 'canoeing',
  Surfing: 'surfing',
  Windsurf: 'surfing',
  Kitesurf: 'surfing',
  StandUpPaddling: 'paddling',
  Sail: 'sailing',

  // Gym / Indoor
  WeightTraining: 'weight_training',
  Yoga: 'yoga',
  Pilates: 'pilates',
  Crossfit: 'high_intensity_interval_training',
  Elliptical: 'elliptical',
  StairStepper: 'stair_climbing_machine',

  // Other
  RockClimbing: 'rock_climbing',
  Skateboard: 'skateboarding',
  InlineSkate: 'roller_skating',
  Golf: 'golf',
  Soccer: 'football',
  Tennis: 'tennis',
  TableTennis: 'table_tennis',
  Badminton: 'badminton',
  Squash: 'squash',
  Pickleball: 'racquetball',
  Wheelchair: 'wheelchair',
}

/**
 * Convert a Strava sport_type to an Aurboda activity type.
 * Falls back to a snake_case conversion if the type is not in the map.
 */
export const mapStravaSportType = (sportType: string): string =>
  stravaSportTypeMap[sportType] ?? toSnakeCase(sportType)

const toSnakeCase = (str: string): string =>
  str
    .replaceAll(/([a-z])([A-Z])/g, '$1_$2')
    .replaceAll(/[\s-]+/g, '_')
    .toLowerCase()
