#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write --allow-run=things-cli,open,npm

import * as path from '@std/path'
import { Command } from '@cliffy/command'
import { Table } from '@cliffy/table'
import $ from 'dax'

import { getCounts, NO_AREA } from './viz.ts'
import { getAllItems } from './data.ts'

function relToAbs(relPath: string) {
  const currFile = path.fromFileUrl(import.meta.url)
  return path.join(path.dirname(currFile), relPath)
}

if (!import.meta.main) Deno.exit()

type Format = 'table' | 'json' | 'tsv'

function renderCountsTable(counts: Record<string, unknown>[]) {
  if (counts.length === 0) return
  const headers = Object.keys(counts[0])
  const rows = counts.map((c) => headers.map((h) => String(c[h] ?? '')))
  new Table().header(headers).body(rows).padding(1).render()
}

function renderTsv(headers: string[], rows: (string | null | undefined)[][]) {
  const escape = (v: string | null | undefined) =>
    (v ?? '').replace(/[\t\n\r]/g, ' ')
  console.log(headers.join('\t'))
  rows.forEach((row) => console.log(row.map(escape).join('\t')))
}

await new Command()
  .name('tviz')
  .description('Visualize Things 3 data')
  .action(async () => {
    const counts = (await getCounts()).slice(-30)
    if (!counts.some((c) => c[NO_AREA])) {
      counts.forEach((c) => delete c[NO_AREA])
    }
    renderCountsTable(counts)
  })
  .command('table')
  .description('prints table of the last 30 days')
  .action(async () => {
    const counts = (await getCounts()).slice(-30)
    if (!counts.some((c) => c[NO_AREA])) {
      counts.forEach((c) => delete c[NO_AREA])
    }
    renderCountsTable(counts)
  })
  .reset()
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
  .reset()
  .command('done')
  .description('lists recent done items')
  .arguments('[area:string]')
  .action(async (_options, area?: string) => {
    let todos = (await getAllItems()).filter((todo) => todo.status === 'completed')
    if (area) {
      todos = todos.filter((todo) => todo.area_title.toLowerCase() === area.toLowerCase())
    }
    new Table()
      .header(['date', 'project', 'title'])
      .body(
        todos.slice(0, 220).map((todo) => [
          todo.stop_date?.toISOString().slice(0, 10) ?? '',
          todo.project_title || '',
          todo.title,
        ])
      )
      .padding(1)
      .render()
  })
  .reset()
  .command('todo')
  .description('lists incomplete items')
  .option('-a, --area <area:string>', 'filter by area name')
  .option('-p, --project <project:string>', 'filter by project name')
  .option('-s, --search <text:string>', 'search in title and notes')
  .option('-d, --deadline', 'only show items with deadlines')
  .option('-r, --recent <days:integer>', 'only show items modified in last N days')
  .option('-v, --verbose', 'include notes/contents of todo')
  .option('-f, --format <format:string>', 'output format: table, json, tsv', { default: 'table' })
  .action(async (options) => {
    const format = options.format as Format
    let todos = (await getAllItems()).filter((todo) => todo.status === 'incomplete')

    if (options.area) {
      todos = todos.filter(
        (todo) => todo.area_title.toLowerCase() === options.area!.toLowerCase()
      )
    }
    if (options.project) {
      todos = todos.filter((todo) =>
        todo.project_title?.toLowerCase().includes(options.project!.toLowerCase())
      )
    }
    if (options.search) {
      const search = options.search.toLowerCase()
      todos = todos.filter(
        (todo) =>
          todo.title.toLowerCase().includes(search) ||
          todo.notes?.toLowerCase().includes(search)
      )
    }
    if (options.deadline) {
      todos = todos.filter((todo) => todo.deadline !== null)
    }
    if (options.recent) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - options.recent)
      todos = todos.filter((todo) => todo.modified && todo.modified >= cutoff)
    }

    if (format === 'json') {
      console.log(
        JSON.stringify(
          todos.map((todo) => ({
            title: todo.title,
            area: todo.area_title,
            project: todo.project_title || null,
            notes: todo.notes || null,
            created: todo.created.toISOString().slice(0, 10),
            modified: todo.modified?.toISOString().slice(0, 10) || null,
            start: todo.start,
            start_date: todo.start_date?.toISOString().slice(0, 10) || null,
            deadline: todo.deadline?.toISOString().slice(0, 10) || null,
          })),
          null,
          2
        )
      )
      return
    }

    if (format === 'tsv') {
      const showArea = !options.area
      const headers = ['created', ...(showArea ? ['area'] : []), 'project', 'title', 'scheduled', 'deadline']
      const rows = todos.map((todo) => [
        todo.created.toISOString().slice(0, 10),
        ...(showArea ? [todo.area_title] : []),
        todo.project_title,
        todo.title,
        todo.start_date?.toISOString().slice(0, 10),
        todo.deadline?.toISOString().slice(0, 10),
      ])
      renderTsv(headers, rows)
      return
    }

    if (options.verbose) {
      todos.forEach((todo, i) => {
        const created = todo.created.toISOString().slice(0, 10)
        const area = todo.area_title || ''
        const project = todo.project_title ? ` > ${todo.project_title}` : ''
        const location = area || project ? `[${area}${project}] ` : ''

        if (i > 0) console.log()
        console.log(`${location}${todo.title}`)
        const dates = [
          `created: ${created}`,
          todo.modified ? `modified: ${todo.modified.toISOString().slice(0, 10)}` : null,
          todo.start !== 'Anytime' ? `when: ${todo.start}` : null,
          todo.start_date ? `scheduled: ${todo.start_date.toISOString().slice(0, 10)}` : null,
          todo.deadline ? `deadline: ${todo.deadline.toISOString().slice(0, 10)}` : null,
        ].filter(Boolean)
        console.log(`  ${dates.join(' | ')}`)
        if (todo.notes) {
          console.log(`  ${todo.notes.replace(/\n/g, '\n  ')}`)
        }
      })
    } else {
      const showArea = !options.area
      const headers = ['created', ...(showArea ? ['area'] : []), 'project', 'title', 'scheduled', 'deadline']
      const rows = todos.map((todo) => [
        todo.created.toISOString().slice(0, 10),
        ...(showArea ? [todo.area_title || ''] : []),
        todo.project_title || '',
        todo.title,
        todo.start_date?.toISOString().slice(0, 10) || '',
        todo.deadline?.toISOString().slice(0, 10) || '',
      ])
      new Table()
        .header(headers)
        .body(rows)
        .border()
        .maxColWidth(50)
        .render()
    }
  })
  .reset()
  .command('areas')
  .description('lists all areas')
  .option('-f, --format <format:string>', 'output format: table, json, tsv', { default: 'table' })
  .action(async (options) => {
    const format = options.format as Format
    const todos = await getAllItems()
    const areas = [...new Set(todos.map((t) => t.area_title))].filter(Boolean).sort()
    if (format === 'json') {
      console.log(JSON.stringify(areas, null, 2))
    } else if (format === 'tsv') {
      renderTsv(['area'], areas.map((a) => [a]))
    } else {
      new Table()
        .header(['area'])
        .body(areas.map((a) => [a]))
        .padding(1)
        .render()
    }
  })
  .reset()
  .command('projects')
  .description('lists all projects with incomplete todos')
  .option('-a, --area <area:string>', 'filter by area name')
  .option('-f, --format <format:string>', 'output format: table, json, tsv', { default: 'table' })
  .action(async (options) => {
    const format = options.format as Format
    let todos = (await getAllItems()).filter(
      (t) => t.status === 'incomplete' && t.project_title
    )
    if (options.area) {
      todos = todos.filter(
        (t) => t.area_title.toLowerCase() === options.area!.toLowerCase()
      )
    }
    const projectSet = new Map<string, string>()
    todos.forEach((t) => projectSet.set(t.project_title!, t.area_title))
    const projects = [...projectSet.entries()]
      .map(([project, area]) => ({ project, area }))
      .sort((a, b) => `${a.area}${a.project}`.localeCompare(`${b.area}${b.project}`))
    if (format === 'json') {
      console.log(JSON.stringify(projects, null, 2))
    } else if (format === 'tsv') {
      renderTsv(['area', 'project'], projects.map((p) => [p.area, p.project]))
    } else {
      new Table()
        .header(['area', 'project'])
        .body(projects.map((p) => [p.area, p.project]))
        .padding(1)
        .render()
    }
  })
  .parse(Deno.args)
