/**
 * Type declarations for @flow-js/garmin-connect deep imports.
 *
 * The package lacks an `exports` map, so TypeScript's `nodenext` module
 * resolution cannot resolve these deep paths. We re-declare them here.
 */
declare module '@flow-js/garmin-connect/dist/garmin/types/activity' {
  export interface IActivity {
    activityId: number
    activityName: string
    startTimeLocal: string
    startTimeGMT: string
    activityType: { typeId: number; typeKey: string; parentTypeId: number }
    distance: number
    duration: number
    elapsedDuration: number
    movingDuration: number
    elevationGain: number
    elevationLoss: number
    averageSpeed: number
    maxSpeed: number
    startLatitude: number
    startLongitude: number
    calories: number
    averageHR: number
    maxHR: number
    steps: number
    beginTimestamp: number
    sportTypeId: number
    vO2MaxValue: number
    maxElevation: number
    minElevation: number
    endLatitude: number
    endLongitude: number
    lapCount: number
    locationName: string
    [key: string]: unknown
  }
}

declare module '@flow-js/garmin-connect/dist/garmin/types/sleep' {
  export interface SleepData {
    dailySleepDTO: {
      id: number
      calendarDate: string
      sleepTimeSeconds: number
      sleepStartTimestampGMT: number
      sleepEndTimestampGMT: number
      deepSleepSeconds: number
      lightSleepSeconds: number
      remSleepSeconds: number
      awakeSleepSeconds: number
      averageSpO2Value: number
      lowestSpO2Value: number
      highestSpO2Value: number
      averageRespirationValue: number
      lowestRespirationValue: number
      highestRespirationValue: number
      sleepScores?: {
        overall?: { value: number }
        [key: string]: unknown
      }
      [key: string]: unknown
    }
    restingHeartRate: number
    avgOvernightHrv: number
    sleepHeartRate: Array<{ value: number; startGMT: string }>
    sleepMovement: Array<{
      startGMT: string
      endGMT: string
      activityLevel: number
    }>
    sleepLevels: Array<{
      startGMT: string
      endGMT: string
      activityLevel: number
    }>
    sleepRestlessMoments: Array<{ value: number; startGMT: string }>
    wellnessEpochSPO2DataDTOList: Array<{
      epochTimestamp: number
      spo2Reading: number
      readingConfidence: number
    }>
    wellnessEpochRespirationDataDTOList: Array<{
      startTimeGMT: number
      respirationValue: number
    }>
    [key: string]: unknown
  }
}
