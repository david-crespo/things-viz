#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open

import { parseArgs } from 'https://deno.land/std@0.221.0/cli/parse_args.ts'
import { sortBy } from './util.ts'
import { plotsApp } from './plot.tsx'
import { getCounts } from './viz.ts'
import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'

async function printTable() {
  const counts = await getCounts()
  const outputTable = sortBy(
    Object.entries(counts).map(([date, value]) => ({
      date,
      ...value,
      Total: Object.values(value).reduce((a, b) => a + b, 0),
    })),
    (d) => d.date,
  )
  console.table(outputTable.slice(-20))
}

const HELP = `
usage: ./viz.ts [cmd]

* 'table' prints table of the last 20 days
  * table is the default, so you can leave it out
* 'plot' runs server showing plot
`

if (import.meta.main) {
  const args = parseArgs(Deno.args, { boolean: ['help'], alias: { h: 'help' } })
  if (args.help) {
    console.log(HELP)
    Deno.exit()
  }
  const cmd = args._.at(0)
  switch (cmd) {
    case undefined:
    case 'table':
      await printTable()
      break
    case 'plot':
      Deno.serve({ port: 7827 }, plotsApp.fetch)
      await $`open http://localhost:7827`
      break
    default:
      console.log(`Error: unrecognized command: ${cmd}`)
      console.log(HELP)
  }
}
