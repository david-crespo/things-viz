#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open,npm

import * as path from '@std/path'
import { parseArgs } from '@std/cli/parse-args'
import $ from 'dax'

import { getCounts, NO_AREA } from './viz.ts'
import { getAllItems } from './data.ts'

function relToAbs(relPath: string) {
  const currFile = path.fromFileUrl(import.meta.url)
  return path.join(path.dirname(currFile), relPath)
}

const HELP = `
usage: ./viz.ts [cmd]

* 'table' prints table of the last 30 days
  * table is the default, so you can leave it out
* 'plot' runs server showing plot
* 'done [optional area]' lists recent done items
`

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ['help'],
    alias: { h: 'help' },
  })
  if (args.help) {
    console.log(HELP)
    Deno.exit()
  }
  const cmd = args._.at(0)
  switch (cmd) {
    case undefined:
    case 'table': {
      const counts = (await getCounts()).slice(-30)
      // if there are no non-zero No area counts, remove the column
      if (!counts.some((c) => c[NO_AREA])) {
        counts.forEach((c) => delete c[NO_AREA])
      }
      console.table(counts)
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
    case 'done': {
      const area = args._.at(1)?.toString().toLowerCase()
      let todos = (await getAllItems()).filter((todo) => todo.status === 'completed')
      if (area) {
        todos = todos.filter((todo) => todo.area_title.toLowerCase() === area)
      }
      console.table(
        todos.slice(0, 220).map((todo) => ({
          date: todo.stop_date?.toISOString().slice(0, 10),
          project: todo.project_title || '',
          title: todo.title,
        })),
      )
      break
    }
    default:
      console.log(`Error: unrecognized command: ${cmd}`)
      console.log(HELP)
  }
}
