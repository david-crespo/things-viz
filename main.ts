#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open,npm

import * as path from 'https://deno.land/std@0.221.0/path/mod.ts'
import { parseArgs } from 'https://deno.land/std@0.221.0/cli/parse_args.ts'
import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'

import { sortBy, sum } from './util.ts'
import { getCounts } from './viz.ts'

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
  console.table(outputTable.slice(-30))
}

async function getPlotData() {
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

function relToAbs(relPath: string) {
  const currFile = path.fromFileUrl(import.meta.url)
  return path.join(path.dirname(currFile), relPath)
}

async function writeJson() {
  const jsonOutput = await getPlotData()
  await Deno.writeTextFile(relToAbs('./output.json'), JSON.stringify(jsonOutput))
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
      await writeJson()
      await $`npm run --prefix ${relToAbs('./plot-app')} dev -- --open`
      break
    case 'json':
      await writeJson()
      break
    default:
      console.log(`Error: unrecognized command: ${cmd}`)
      console.log(HELP)
  }
}
