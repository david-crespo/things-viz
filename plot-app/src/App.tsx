import { useEffect, useRef } from 'react'
import rawData from '../../output.json'
import * as Plot from '@observablehq/plot'

type Point = { date: Date; area: string; count: number }

const data = rawData
  .map(({ date, ...rest }) => ({ date: new Date(date), ...rest }))

const cutoff = new Date(2022, 0, 1)

const breakdown = data.filter(({ area, date }) => area !== 'Total' && date > cutoff)

function Todos({ data }: { data: Point[] }) {
  const containerRef = useRef(null)
  useEffect(() => {
    if (data === undefined || !containerRef.current) return
    const plot = Plot.plot({
      style: 'overflow: visible;',
      y: { grid: true },
      title: 'Open to-dos over time (breakdown)',
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
    containerRef.current.append(plot)
    return () => plot.remove()
  }, [data])
  return <div ref={containerRef}></div>
}

export default function App() {
  return <Todos data={breakdown} />
}
