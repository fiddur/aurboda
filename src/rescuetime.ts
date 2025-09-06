import axios from 'axios'
import { addSeconds, formatISO } from 'date-fns'

type RtData = {
  startTime: Date
  endTime: Date
  duration: number
  activity: string
  mobile: boolean
  category: string
  productivity: number
}

export const rescuetimeClient = (key: string) => {
  if (!key) throw new Error('RescueTime key missing')

  return {
    async getIntervalData(start: Date, end: Date): Promise<RtData[]> {
      const response = await axios.get(
        `https://www.rescuetime.com/anapi/data?key=${key}&perspective=interval&resolution_time=minute&restrict_begin=${formatISO(start, { representation: 'date' })}&restrict_end=${formatISO(end, { representation: 'date' })}&format=json`,
      )
      return response.data.rows.map(
        ([time, duration, _people, activity, category, productivity]: [
          string,
          number,
          number,
          string,
          string,
          number,
        ]) => ({
          startTime: new Date(`${time}+02:00`),
          endTime: addSeconds(new Date(`${time}+02:00`), duration),
          duration,
          activity,
          mobile: activity.startsWith('mobile - '),
          category,
          productivity,
        }),
      )
    },
  }
}
