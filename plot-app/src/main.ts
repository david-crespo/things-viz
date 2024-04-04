import rawData from '../../output.json'
import * as Plot from '@observablehq/plot'

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

const allData = rawData
  .map(({ date, ...rest }) => ({ date: new Date(date), ...rest }))

const cutoff = new Date(2022, 0, 1)

const breakdownPlot = getPlot(
  'Breakdown',
  allData.filter(({ area, date }) =>
    area !== 'Total' && area !== 'Completions' && date > cutoff
  ),
)
const totalPlot = getPlot('Total', allData.filter(({ area }) => area === 'Total'))
const oxidePlot = getPlot('Oxide', allData.filter(({ area }) => area === 'Oxide'))
const completionsPlot = getPlot(
  'Completions (30 day moving average)',
  movingAvg(allData.filter(({ area }) => area === 'Completions'), 30)
    .map((p) => ({ ...p, area: 'Completions' })),
)

const div = document.querySelector('#root')!
div.append(breakdownPlot)
div.append(totalPlot)
div.append(oxidePlot)
div.append(completionsPlot)
