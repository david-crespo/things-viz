import { useEffect, useRef } from 'react'
import rawData from '../../output.json'
import * as Plot from '@observablehq/plot'

const getPlot = (label: string, data: typeof allData) =>
  Plot.plot({
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
  allData.filter(({ area, date }) => area !== 'Total' && date > cutoff),
)
const totalPlot = getPlot('total', allData.filter(({ area }) => area === 'Total'))
const oxidePlot = getPlot('Oxide', allData.filter(({ area }) => area === 'Oxide'))

function RenderPlot({ plot }: { plot: ReturnType<typeof Plot.plot> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!containerRef.current) return
    containerRef.current.append(plot)
    return () => plot.remove()
  }, [getPlot])
  return <div ref={containerRef}></div>
}

export default function App() {
  return (
    <>
      <RenderPlot plot={breakdownPlot} />
      <RenderPlot plot={totalPlot} />
      <RenderPlot plot={oxidePlot} />
    </>
  )
}
