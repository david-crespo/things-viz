import rawData from '../../output.json'
import * as Plot from '@observablehq/plot'

import './index.css'

const getPlot = (label: string, data: typeof allData) =>
  Plot.plot({
    width: 960,
    style: 'overflow: visible;',
    y: { grid: true },
    title: `Open to-dos (${label})`,
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
  'breakdown',
  allData.filter(({ area, date }) =>
    area !== 'Total' && area !== 'Completions' && date > cutoff
  ),
)
const totalPlot = getPlot('total', allData.filter(({ area }) => area === 'Total'))
const oxidePlot = getPlot('Oxide', allData.filter(({ area }) => area === 'Oxide'))
const completionsPlot = getPlot(
  'completions per day',
  allData.filter(({ area }) => area === 'Completions'),
)

const div = document.querySelector('#root')!
div.append(breakdownPlot)
div.append(totalPlot)
div.append(oxidePlot)
div.append(completionsPlot)
