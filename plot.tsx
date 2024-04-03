/** @jsx jsx */
import { Hono } from 'https://deno.land/x/hono@v4.2.0/mod.ts'
import { jsx } from 'https://deno.land/x/hono@v4.2.0/middleware.ts'
import { sortBy, sum } from './util.ts'
import { getCounts } from './viz.ts'
// import * as Plot from "npm:@observablehq/plot@0.6.14";

export async function getPlotData() {
  const counts = await getCounts()

  // output for observable plot
  const output = sortBy(
    Object.entries(counts).flatMap(([date, value]) => {
      const entries = Object.entries(value)
      return [...entries.map(([area, count]) => ({ date, area, count })), {
        date,
        area: 'Total',
        count: sum(entries.map(([_area, count]) => count)),
      }]
    }),
    (d) => d.date,
  )
  return output
}

function Plot() {
  return <h1>Open to-dos over time</h1>
}

export const plotsApp = new Hono()
plotsApp.get('/', (c) => {
  return c.html(<Plot />)
})
