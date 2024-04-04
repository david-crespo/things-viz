#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open,npm

import * as path from 'https://deno.land/std@0.221.0/path/mod.ts'
import { parseArgs } from 'https://deno.land/std@0.221.0/cli/parse_args.ts'
import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'

import { getCounts } from './viz.ts'

function relToAbs(relPath: string) {
  const currFile = path.fromFileUrl(import.meta.url)
  return path.join(path.dirname(currFile), relPath)
}

const HELP = `
usage: ./viz.ts [cmd]

* 'table' prints table of the last 30 days
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
    case 'table': {
      const counts = await getCounts()
      console.table(counts.slice(-30))
      break
    }
    case 'plot': {
      const counts = await getCounts()
      const plotData = counts.flatMap(({ date, ...dateCounts }) =>
        Object.entries(dateCounts).map(([area, count]) => ({ date, area, count }))
      )
      await Deno.writeTextFile(relToAbs('./output.json'), JSON.stringify(plotData))
      await $`npm run --prefix ${relToAbs('./plot-app')} dev -- --open`
      break
    }
    default:
      console.log(`Error: unrecognized command: ${cmd}`)
      console.log(HELP)
  }
}
