import * as d3 from 'd3'
import { addDays, isBefore, subDays } from 'date-fns'
import { JSDOM } from 'jsdom'

import type { ouraClient } from './integrations/oura/client.ts'

import { getActivities, getLocations, getTimeSeries } from './db/index.ts'
import { rescuetimeClient } from './integrations/rescuetime/client.ts'
import { getSettings } from './services/settings.ts'

export const getTimeline = async (oura: ReturnType<typeof ouraClient>) => {
  const now = new Date()
  const start = subDays(now, 4)
  const end = addDays(now, 1)

  const user = 'fiddur'

  const { places } = await getLocations(user, start, end)
  const settings = await getSettings(user)
  const rtData = settings.rescue_time_key
    ? await rescuetimeClient(settings.rescue_time_key).getIntervalData(start, end)
    : []
  const ouraToken = await oura.getAccessToken(user)
  const tags = await oura.getTags(start, end, ouraToken, settings.tag_mappings)
  const meditations = await oura.getSessions(start, end, ouraToken)

  const placeColors: Record<string, string> = {
    Genki: 'darkgrey',
    Hökås: 'lightgreen',
    Lönnåsen: 'olive',
  }

  const margin = { bottom: 100, left: 50, right: 30, top: 40 }
  const width = 1600 - margin.left - margin.right
  const height = 800 - margin.top - margin.bottom

  const trackHeight = height / 10
  const trackComputer = 0
  const trackMobile = trackHeight
  const trackExercise = 2 * trackHeight
  const trackPlaces = 3 * trackHeight

  const dom = new JSDOM(`<!DOCTYPE html><html><body id="my"></body></html>`, {
    pretendToBeVisual: true,
  })

  const body = d3.select(dom.window.document.querySelector('#my'))
  const svg = body
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // 2. Create Scales
  const xScale = d3.scaleTime().domain([start, now]).range([0, width])

  const yScale = d3.scaleLinear().domain([45, 190]).range([height, 0])

  // 3. Draw Axes
  svg
    .append('g')
    .attr('transform', `translate(0,${height})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(d3.timeHour.every(6))
        .tickFormat((d) => d3.timeFormat('%a %H')(d as Date)),
    )

  svg.append('g').call(d3.axisLeft(yScale))

  // 4. Draw Data Layers

  const heartRates = await getTimeSeries(user, 'heart_rate', start, end)
  const sleepSessions = await getActivities(user, 'sleep', start, end)
  const exerciseSessions = await getActivities(user, 'exercise', start, end)

  // -- Sleep spans
  sleepSessions.forEach(({ start_time, end_time }) => {
    if (!end_time) return
    svg
      .append('rect')
      .attr('x', xScale(start_time))
      .attr('y', 0)
      .attr('width', xScale(end_time) - xScale(start_time))
      .attr('height', height)
      .attr('fill', 'blue')
      .attr('opacity', 0.2)
  })
  meditations.forEach(({ startTime, endTime }) => {
    if (isBefore(startTime, start)) return
    svg
      .append('rect')
      .attr('x', xScale(startTime))
      .attr('y', 0)
      .attr('width', xScale(endTime) - xScale(startTime))
      .attr('height', height)
      .attr('fill', 'purple')
      .attr('opacity', 0.6)
  })

  rtData.forEach(({ startTime, endTime, mobile }) => {
    if (isBefore(startTime, start)) return
    svg
      .append('rect')
      .attr('x', xScale(startTime))
      .attr('y', mobile ? trackMobile : trackComputer)
      .attr('width', xScale(endTime) - xScale(startTime))
      .attr('height', trackHeight)
      .attr('fill', mobile ? 'darkcyan' : 'darkblue')
      .attr('opacity', 0.8)
  })

  exerciseSessions.forEach(({ start_time, end_time }) => {
    if (!end_time) return
    svg
      .append('rect')
      .attr('x', xScale(start_time))
      .attr('y', trackExercise)
      .attr('width', xScale(end_time) - xScale(start_time))
      .attr('height', trackHeight)
      .attr('fill', 'green')
      .attr('opacity', 0.2)
  })

  places.forEach(({ startTime, endTime, region }) => {
    svg
      .append('rect')
      .attr('x', xScale(startTime))
      .attr('y', trackPlaces)
      .attr('width', xScale(endTime) - xScale(startTime))
      .attr('height', trackHeight)
      .attr('fill', placeColors[region] || 'lightgray')
    //.attr('opacity', 0.2)
  })

  // (repeat for exercises with green color)

  // -- Heart Rate Line
  const line = d3
    .line<[Date, number]>()
    .x(([time]) => xScale(new Date(time)))
    .y(([, value]) => yScale(value))
  svg
    .append('path')
    .datum(heartRates)
    .attr('fill', 'none')
    .attr('stroke', 'red')
    .attr('stroke-width', 1.5)
    .attr('d', line)

  // -- Tags
  tags.forEach(({ start_time, end_time }) => {
    if (end_time) {
      svg
        .append('rect')
        .attr('x', xScale(start_time))
        .attr('y', 0)
        .attr('width', xScale(end_time) - xScale(start_time))
        .attr('height', height)
        //.attr('fill', 'black')
        .attr('stroke', 'black')
        .attr('stroke-dasharray', '4')
        .attr('opacity', 0.2)
    } else {
      svg
        .append('line')
        .attr('x1', xScale(start_time))
        .attr('y1', 0)
        .attr('x2', xScale(start_time))
        .attr('y2', height)
        .attr('stroke', 'black')
        .attr('stroke-dasharray', '4')
        .attr('opacity', 0.2)
    }
    // (add d3.text for labels)
  })

  return dom.serialize()
}
