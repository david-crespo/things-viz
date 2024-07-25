import rawData from '../../output.json'
import * as Plot from '@observablehq/plot'
import { dateToStr } from '../../util.ts'

import './index.css'

type Point = typeof allData[number]

// assumes the data are sorted and there is a data point for every day
function movingAvg(data: Point[], windowSize: number) {
  const result = []
  let sum = 0
  let start = 0

  for (let i = 0; i < data.length; i++) {
    sum += data[i].count

    if (i - start + 1 === windowSize) {
      result.push({ date: data[start].date, count: sum / windowSize })

      sum -= data[start].count
      start++
    }
  }

  return result
}

const getPlot = (title: string, data: Point[]) =>
  Plot.plot({
    width: 960,
    style: 'overflow: visible;',
    y: { grid: true },
    title,
    marks: [
      Plot.lineY(data, { x: 'date', y: 'count', stroke: 'area' }),
      Plot.text(
        data,
        Plot.selectLast({
          x: 'date',
          y: 'count',
          z: 'area',
          text: 'area',
          textAnchor: 'start',
          dx: 3,
        }),
      ),
    ],
  })

const getStartInput = () => document.querySelector('input[name=start]')!
const getEndInput = () => document.querySelector('input[name=end]')!

function render() {
  const start = new Date(getStartInput().value)
  const end = new Date(getEndInput().value)

  const allData = rawData
    .map(({ date, ...rest }) => ({ date: new Date(date), ...rest })).filter(({ date }) =>
      date >= start && date <= end
    )

  const breakdownPlot = getPlot(
    'Breakdown',
    allData.filter(({ area, date }) => area !== 'Total' && area !== 'Completions'),
  )
  const totalPlot = getPlot('Total', allData.filter(({ area }) => area === 'Total'))
  const oxidePlot = getPlot('Oxide', allData.filter(({ area }) => area === 'Oxide'))

  const completionsData = allData.filter(({ area }) => area === 'Completions')

  // remove last data point because it's a fake one that's always zero
  if (completionsData.at(-1).count === 0) {
    completionsData.pop()
  }

  const completionsPlot = getPlot(
    'Completions (30 day moving average)',
    movingAvg(completionsData, 30).map((p) => ({ ...p, area: 'Completions' })),
  )

  const div = document.querySelector('#plots')!

  div.innerHTML = ''
  div.append(breakdownPlot)
  div.append(totalPlot)
  div.append(oxidePlot)
  div.append(completionsPlot)
}

function daysAgo(n: number) {
  const today = new Date()
  const start = new Date()
  start.setDate(today.getDate() - n)
  return start
}

function renderLast(n: number) {
  getStartInput().value = dateToStr(daysAgo(n))
  getEndInput().value = dateToStr(daysAgo(-1))
  render()
}

renderLast(365)

window.render = render
window.renderLast = renderLast
