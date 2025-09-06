import * as d3 from 'd3'
import { addDays, isBefore, subDays } from 'date-fns'
import { JSDOM } from 'jsdom'
import { getHcData, getLocations } from './db'
import { ouraClient } from './oura'
import { rescuetimeClient } from './rescuetime'

export const getTimeline = async (oura: ReturnType<typeof ouraClient>) => {
  const now = new Date()
  const start = subDays(now, 4)
  const end = addDays(now, 1)

  const user = 'fiddur'

  const { locations, places } = await getLocations(start, end, user)
  const rtData = await rescuetimeClient(process.env.RESCUETIME_KEY).getIntervalData(start, end)
  const ouraToken = await oura.getAccessToken(user)
  const tags = await oura.getTags(start, end, ouraToken)

  console.log(tags)

  const placeColors = {
    Hökås: 'lightgreen',
    Lönnåsen: 'olive',
    Genki: 'darkgrey',
  }

  const margin = { top: 40, right: 30, bottom: 100, left: 50 }
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
    .call(d3.axisBottom(xScale).ticks(d3.timeHour.every(6)).tickFormat(d3.timeFormat('%a %H')))

  svg.append('g').call(d3.axisLeft(yScale))

  // 4. Draw Data Layers

  const { exerciseSessions, sleepSessions, heartRates } = await getHcData(start, end, 'fiddur')

  // -- Sleep spans
  sleepSessions.forEach(({ startTime, endTime }) => {
    svg
      .append('rect')
      .attr('x', xScale(startTime))
      .attr('y', 0)
      .attr('width', xScale(endTime) - xScale(startTime))
      .attr('height', height)
      .attr('fill', 'blue')
      .attr('opacity', 0.2)
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

  exerciseSessions.forEach(({ startTime, endTime }) => {
    svg
      .append('rect')
      .attr('x', xScale(startTime))
      .attr('y', trackExercise)
      .attr('width', xScale(endTime) - xScale(startTime))
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
  tags.forEach(({ startTime, endTime, tag }) => {
    if (endTime) {
      svg
        .append('rect')
        .attr('x', xScale(startTime))
        .attr('y', 0)
        .attr('width', xScale(endTime) - xScale(startTime))
        .attr('height', height)
        //.attr('fill', 'black')
        .attr('stroke', 'black')
        .attr('stroke-dasharray', '4')
        .attr('opacity', 0.2)
    } else {
      svg
        .append('line')
        .attr('x1', xScale(startTime))
        .attr('y1', 0)
        .attr('x2', xScale(startTime))
        .attr('y2', height)
        .attr('stroke', 'black')
        .attr('stroke-dasharray', '4')
        .attr('opacity', 0.2)
    }
    // (add d3.text for labels)
  })

  return dom.serialize()
}
