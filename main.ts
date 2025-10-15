#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open,npm

import * as path from '@std/path'
import { Command } from 'commander'
import $ from 'dax'

import { getCounts, NO_AREA } from './viz.ts'
import { getAllItems } from './data.ts'

function relToAbs(relPath: string) {
  const currFile = path.fromFileUrl(import.meta.url)
  return path.join(path.dirname(currFile), relPath)
}

if (!import.meta.main) Deno.exit()

const program = new Command()

program
  .name('tviz')
  .description('Visualize Things 3 data')
  .version('1.0.0')
  .action(async () => {
    // Default action: show table
    const counts = (await getCounts()).slice(-30)
    // if there are no non-zero No area counts, remove the column
    if (!counts.some((c) => c[NO_AREA])) {
      counts.forEach((c) => delete c[NO_AREA])
    }
    console.table(counts)
  })

program
  .command('table')
  .description('prints table of the last 30 days')
  .action(async () => {
    const counts = (await getCounts()).slice(-30)
    // if there are no non-zero No area counts, remove the column
    if (!counts.some((c) => c[NO_AREA])) {
      counts.forEach((c) => delete c[NO_AREA])
    }
    console.table(counts)
  })

program
  .command('plot')
  .description('runs server showing plot')
  .action(async () => {
    const counts = await getCounts()
    const plotData = counts.flatMap(({ date, ...dateCounts }) =>
      Object.entries(dateCounts).map(([area, count]) => ({ date, area, count }))
    )
    await Deno.writeTextFile(relToAbs('./output.json'), JSON.stringify(plotData))
    await $`npm run --prefix ${relToAbs('./plot-app')} dev -- --open`
  })

program
  .command('done')
  .description('lists recent done items')
  .argument('[area]', 'filter by area name')
  .action(async (area?: string) => {
    let todos = (await getAllItems()).filter((todo) => todo.status === 'completed')
    if (area) {
      todos = todos.filter((todo) => todo.area_title.toLowerCase() === area.toLowerCase())
    }
    console.table(
      todos.slice(0, 220).map((todo) => ({
        date: todo.stop_date?.toISOString().slice(0, 10),
        project: todo.project_title || '',
        title: todo.title,
      })),
    )
  })

program
  .command('todo')
  .description('lists incomplete items')
  .option('-a, --area <area>', 'filter by area name')
  .option('-v, --verbose', 'include notes/contents of todo')
  .action(async (options: { area?: string; verbose?: boolean }) => {
    let todos = (await getAllItems()).filter((todo) => todo.status === 'incomplete')
    if (options.area) {
      todos = todos.filter((todo) => todo.area_title.toLowerCase() === options.area!.toLowerCase())
    }
    todos.forEach((todo) => {
      const date = todo.created.toISOString().slice(0, 10)
      const area = todo.area_title || ''
      const project = todo.project_title ? ` > ${todo.project_title}` : ''
      const location = area || project ? `[${area}${project}] ` : ''
      console.log(`${date} ${location}${todo.title}`)
      if (options.verbose && todo.notes) {
        console.log(`  ${todo.notes.replace(/\n/g, '\n  ')}`)
      }
    })
  })

await program.parseAsync(Deno.args, { from: 'user' })
