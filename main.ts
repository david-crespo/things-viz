#!/usr/bin/env deno run --allow-net=0.0.0.0:8000 --allow-env=THINGSDB,HOME,THINGS_TOKEN --allow-read --allow-run=open

import { z } from 'zod'
import { match } from 'ts-pattern'
import { Command, ValidationError } from '@cliffy/command'
import { Table } from '@cliffy/table'

import { load as loadEnv } from '@std/dotenv'

import {
  getAllItems,
  getAreas,
  getCounts,
  getItemByUuid,
  getProjects,
  getTodoByUuid,
  getViewItems,
  NO_AREA,
  type Todo,
  type ViewName,
} from './data.ts'
import plotTemplate from './plot.html' with { type: 'text' }

if (!import.meta.main) Deno.exit()

await loadEnv({ envPath: `${import.meta.dirname}/.env`, export: true })

function requireToken(): string {
  const token = Deno.env.get('THINGS_TOKEN')
  if (!token) {
    console.error('THINGS_TOKEN required. Set it in env or .env file.')
    Deno.exit(1)
  }
  return token
}

async function readStdin(): Promise<string | undefined> {
  if (Deno.stdin.isTerminal()) return undefined
  const buf = await new Response(Deno.stdin.readable).text()
  return buf.trimEnd()
}

async function openThingsUrl(
  action: string,
  params: Record<string, string>,
) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const urlStr = `things:///${action}?${query}`
  const displayQuery = Object.entries(params)
    .map(([k, v]) =>
      `${encodeURIComponent(k)}=${k === 'auth-token' ? '***' : encodeURIComponent(v)}`
    )
    .join('&')
  console.error(`things:///${action}?${displayQuery}`)
  const { code } = await new Deno.Command('open', { args: [urlStr] }).output()
  if (code !== 0) {
    console.error(`Failed to open URL (exit code ${code})`)
    Deno.exit(1)
  }
}

const Format = z.enum(['json', 'tsv', 'pretty', 'short'])

function parseFormat(format: string) {
  const result = Format.safeParse(format)
  if (!result.success) {
    throw new ValidationError(`Invalid format argument '${format}'`)
  }
  return result.data
}

const formatOption = {
  flags: '-f, --format <format:string>',
  desc: 'short, pretty, json, tsv',
  opts: { default: 'short' as const, value: parseFormat },
} as const

function viewCommand(view: ViewName, description: string) {
  return new Command()
    .description(description)
    .option(formatOption.flags, formatOption.desc, formatOption.opts)
    .action(async ({ format }) => renderTodos(await getViewItems(view), format))
}

function renderCountsTable(counts: Record<string, unknown>[]) {
  if (counts.length === 0) return
  // Collect all keys across all rows to avoid missing columns
  const allKeys = new Set(counts.flatMap(Object.keys))
  // Order: date, Total, Completions, No area, then remaining areas sorted
  const priority = ['date', 'Total', 'Completions', NO_AREA]
  const headers = [
    ...priority.filter((k) => allKeys.has(k)),
    ...[...allKeys].filter((k) => !priority.includes(k)).sort(),
  ]
  const rows = counts.map((c) => headers.map((h) => String(c[h] ?? '')))
  new Table().header(headers).body(rows).padding(1).render()
}

function renderTsv(headers: string[], rows: (string | null | undefined)[][]) {
  const escape = (v: string | null | undefined) => (v ?? '').replace(/[\t\n\r]/g, ' ')
  console.log(headers.join('\t'))
  rows.forEach((row) => console.log(row.map(escape).join('\t')))
}

type RenderFormat = z.infer<typeof Format>

function fmtLocation(todo: Todo): string {
  const area = todo.area_title || ''
  const project = todo.project_title ? ` > ${todo.project_title}` : ''
  const heading = todo.heading_title ? ` > ${todo.heading_title}` : ''
  return area || project ? `[${area}${project}${heading}] ` : ''
}

/** Date/status tags shared by short and pretty formats. */
function todoDateTags(todo: Todo): string[] {
  const doneLabel = todo.status === 'canceled' ? 'canceled' : 'done'
  return [
    todo.stop_date ? `${doneLabel}: ${todo.stop_date.toISOString().slice(0, 10)}` : null,
    // Suppress the start bucket (e.g. "someday") when a scheduled date is
    // present — the bucket is a Things implementation detail, and the date
    // already tells the user when the item will appear.
    todo.start !== 'Anytime' && !todo.start_date ? todo.start.toLowerCase() : null,
    todo.start_date ? `scheduled: ${todo.start_date.toISOString().slice(0, 10)}` : null,
    todo.deadline ? `deadline: ${todo.deadline.toISOString().slice(0, 10)}` : null,
  ].filter((s): s is string => s !== null)
}

function renderTodos(todos: Todo[], format: RenderFormat, showArea = true) {
  match(format)
    .with('json', () => {
      console.log(
        JSON.stringify(
          todos.map((todo) => ({
            uuid: todo.uuid,
            title: todo.title,
            area: todo.area_title,
            project: todo.project_title || null,
            notes: todo.notes || null,
            created: todo.created.toISOString(),
            modified: todo.modified?.toISOString() || null,
            stop_date: todo.stop_date?.toISOString().slice(0, 10) || null,
            start: todo.start,
            start_date: todo.start_date?.toISOString().slice(0, 10) || null,
            deadline: todo.deadline?.toISOString().slice(0, 10) || null,
            checklist: todo.checklist || null,
          })),
          null,
          2,
        ),
      )
    })
    .with('tsv', () => {
      const headers = [
        'uuid',
        'created',
        'stop_date',
        ...(showArea ? ['area'] : []),
        'project',
        'heading',
        'title',
        'scheduled',
        'deadline',
      ]
      const rows = todos.map((todo) => [
        todo.uuid,
        todo.created.toISOString().slice(0, 10),
        todo.stop_date?.toISOString().slice(0, 10),
        ...(showArea ? [todo.area_title] : []),
        todo.project_title,
        todo.heading_title,
        todo.title,
        todo.start_date?.toISOString().slice(0, 10),
        todo.deadline?.toISOString().slice(0, 10),
      ])
      renderTsv(headers, rows)
    })
    .with('short', () => {
      todos.forEach((todo) => {
        const location = fmtLocation(todo)
        const dateSuffix = todoDateTags(todo)
        const suffix = dateSuffix.length ? ` (${dateSuffix.join(', ')})` : ''
        console.log(`${location}${todo.title}${suffix}`)
      })
    })
    .with('pretty', () => {
      todos.forEach((todo, i) => {
        const location = fmtLocation(todo)
        if (i > 0) console.log()
        console.log(`${location}${todo.title}`)
        const dates = [
          `created: ${todo.created.toISOString().slice(0, 10)}`,
          todo.modified ? `modified: ${todo.modified.toISOString().slice(0, 10)}` : null,
          ...todoDateTags(todo),
        ].filter(Boolean)
        console.log(`  ${dates.join(' | ')}`)
        if (todo.notes) {
          console.log(`  ${todo.notes.replace(/\n/g, '\n  ')}`)
        }
        if (Array.isArray(todo.checklist)) {
          for (const item of todo.checklist) {
            const mark = item.status === 'completed' ? '✓' : '○'
            console.log(`  ${mark} ${item.title}`)
          }
        }
      })
    })
    .exhaustive()
}

await new Command()
  .name('tviz')
  .description('Visualize Things 3 data')
  .action(() => {
    throw new ValidationError('Command required')
  })
  .command('table')
  .description('print table of the last 30 days')
  .action(async () => {
    const counts = (await getCounts()).slice(-30)
    if (!counts.some((c) => c[NO_AREA])) {
      counts.forEach((c) => delete c[NO_AREA])
    }
    renderCountsTable(counts)
  })
  .reset()
  .command('plot')
  .description('run server showing plot')
  .action(() => {
    const serveOptions = { hostname: '0.0.0.0', port: 8000 }
    const url = `http://${serveOptions.hostname}:${serveOptions.port}`

    async function handler() {
      const counts = await getCounts()
      const plotData = counts.flatMap(({ date, ...dateCounts }) =>
        Object.entries(dateCounts).map(([area, count]) => ({ date, area, count }))
      )
      const html = plotTemplate.replace('/*__DATA__*/ []', JSON.stringify(plotData))
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    }

    try {
      Deno.serve(serveOptions, handler)
    } catch (e) {
      if (e instanceof Deno.errors.AddrInUse) {
        console.error(`Server already running at ${url}. Opening...`)
        // still open it
        new Deno.Command('open', { args: [url] }).spawn()
        return
      }
      throw e
    }
    new Deno.Command('open', { args: [url] }).spawn()
  })
  .reset()
  .command('logbook')
  .description('list completed items')
  .option('-a, --area <area:string>', 'filter by area name')
  .option('-n, --limit <limit:integer>', 'max items to show', { default: 50 })
  .option(formatOption.flags, formatOption.desc, formatOption.opts)
  .action(async ({ area, limit, format }) => {
    let todos = (await getAllItems()).filter(
      (todo) => todo.status === 'completed' || todo.status === 'canceled',
    )
    if (area) {
      todos = todos.filter((todo) => todo.area_title.toLowerCase() === area.toLowerCase())
    }
    todos = todos
      .filter((todo) => todo.stop_date !== null)
      .sort((a, b) => b.stop_date!.getTime() - a.stop_date!.getTime())
      .slice(0, limit)
    renderTodos(todos, format, !area)
  })
  .reset()
  .command('todos')
  .description('list items')
  .option('-a, --area <area:string>', 'filter by area name')
  .option('-p, --project <project:string>', 'filter by project name')
  .option('-s, --search <text:string>', 'search in title and notes')
  .option('-d, --deadline', 'only show items with deadlines')
  .option('-r, --recent <days:integer>', 'only show items modified in last N days')
  .option('-c, --completed', 'show only completed items')
  .option('--all', 'show all items regardless of status')
  .option(formatOption.flags, formatOption.desc, formatOption.opts)
  .action(async (options) => {
    const incompleteOnly = !options.completed && !options.all
    let todos = await getAllItems({ incompleteOnly })
    if (options.completed) {
      todos = todos.filter((todo) => todo.status === 'completed')
    }

    if (options.area) {
      todos = todos.filter(
        (todo) => todo.area_title.toLowerCase() === options.area!.toLowerCase(),
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
          todo.notes?.toLowerCase().includes(search),
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

    renderTodos(todos, options.format, !options.area)
  })
  .reset()
  .command('areas')
  .description('list all areas')
  .option(formatOption.flags, formatOption.desc, {
    ...formatOption.opts,
    default: 'pretty',
  })
  .action(async ({ format }) => {
    const areas = await getAreas()
    match(format)
      .with('json', () => console.log(JSON.stringify(areas, null, 2)))
      .with('tsv', () => renderTsv(['area'], areas.map((a) => [a])))
      .with('short', 'pretty', () => areas.forEach((a) => console.log(a)))
      .exhaustive()
  })
  .reset()
  .command('projects')
  .description('list projects')
  .option('-a, --area <area:string>', 'filter by area name')
  .option('-c, --completed', 'show only completed projects')
  .option('--all', 'show all projects regardless of status')
  .option(formatOption.flags, formatOption.desc, {
    ...formatOption.opts,
    default: 'pretty',
  })
  .action(async ({ area, completed, all, format }) => {
    let projects = await getProjects()
    if (completed) {
      projects = projects.filter((p) => p.status === 'completed')
    } else if (!all) {
      projects = projects.filter((p) => p.status === 'incomplete')
    }
    if (area) {
      projects = projects.filter(
        (p) => p.area_title.toLowerCase() === area!.toLowerCase(),
      )
    }
    projects.sort((a, b) =>
      `${a.area_title}${a.title}`.localeCompare(`${b.area_title}${b.title}`)
    )
    const fmtDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
    match(format)
      .with('json', () => {
        console.log(JSON.stringify(
          projects.map((p) => ({
            area: p.area_title,
            project: p.title,
            start: p.start,
            start_date: fmtDate(p.start_date),
            deadline: fmtDate(p.deadline),
            created: p.created?.toISOString() || null,
          })),
          null,
          2,
        ))
      })
      .with('tsv', () => {
        renderTsv(
          ['area', 'project', 'when', 'start_date', 'deadline', 'created'],
          projects.map((p) => [
            p.area_title,
            p.title,
            p.start,
            fmtDate(p.start_date),
            fmtDate(p.deadline),
            fmtDate(p.created),
          ]),
        )
      })
      .with('short', 'pretty', () => {
        projects.forEach((p) => {
          const dates = [
            fmtDate(p.start_date) ? `scheduled: ${fmtDate(p.start_date)}` : null,
            fmtDate(p.deadline) ? `deadline: ${fmtDate(p.deadline)}` : null,
          ].filter(Boolean)
          const dateSuffix = dates.length ? ` (${dates.join(' | ')})` : ''
          console.log(`[${p.area_title}] ${p.title}${dateSuffix}`)
        })
      })
      .exhaustive()
  })
  .command('today', viewCommand('today', 'list tasks in Today view'))
  .command('inbox', viewCommand('inbox', 'list tasks in Inbox'))
  .command(
    'anytime',
    viewCommand('anytime', 'list tasks in Anytime view (no schedule, ready to do)'),
  )
  .command(
    'upcoming',
    viewCommand('upcoming', 'list tasks in Upcoming view (scheduled for future)'),
  )
  .command('someday', viewCommand('someday', 'list tasks in Someday view (deferred)'))
  .command(
    'link',
    new Command()
      .description('output OSC 8 hyperlink for a Things item')
      .arguments('<uuid:string>')
      .action(async (_options, uuid: string) => {
        const item = await getItemByUuid(uuid)
        if (!item) {
          console.error(`Item not found: ${uuid}`)
          Deno.exit(1)
        }
        const url = `things:///show?id=${uuid}`
        console.log(`\x1b]8;;${url}\x1b\\\x1b[34m${item.title}\x1b[0m\x1b]8;;\x1b\\`)
      }),
  )
  .command(
    'item',
    new Command()
      .description('show a single item by uuid')
      .arguments('<uuid:string>')
      .option(formatOption.flags, formatOption.desc, formatOption.opts)
      .action(async ({ format }, uuid: string) => {
        const item = await getItemByUuid(uuid)
        if (!item) {
          console.error(`Item not found: ${uuid}`)
          Deno.exit(1)
        }
        if (item.type === 'to-do') {
          const todo = await getTodoByUuid(uuid)
          renderTodos([todo!], format)
        } else if (item.type === 'project') {
          console.log(`[Project] ${item.title}`)
        } else if (item.type === 'area') {
          console.log(`[Area] ${item.title}`)
        }
      }),
  )
  .command(
    'add',
    new Command()
      .description('create items via Things URL scheme')
      .action(() => {
        throw new ValidationError('Subcommand required: todo, project')
      })
      .command(
        'todo',
        new Command()
          .description('create a new todo')
          .arguments('<title:string>')
          .option('--area <area:string>', 'area name')
          .option('--project <project:string>', 'project name')
          .option('--heading <heading:string>', 'heading within project')
          .option(
            '--when <when:string>',
            'today, tomorrow, evening, anytime, someday, or date',
          )
          .option('--deadline <deadline:string>', 'deadline date')
          .action(async ({ area, project, heading, when, deadline }, title: string) => {
            if (area && project) {
              throw new ValidationError('--area and --project are mutually exclusive')
            }
            const notes = await readStdin()
            const params: Record<string, string> = { title }
            if (area) params.list = area
            if (project) params.list = project
            if (heading) params.heading = heading
            if (when) params.when = when
            if (deadline) params.deadline = deadline
            if (notes) params.notes = notes
            await openThingsUrl('add', params)
          }),
      )
      .command(
        'project',
        new Command()
          .description('create a new project')
          .arguments('<title:string>')
          .option('--area <area:string>', 'area name')
          .option(
            '--when <when:string>',
            'today, tomorrow, evening, anytime, someday, or date',
          )
          .option('--deadline <deadline:string>', 'deadline date')
          .action(async ({ area, when, deadline }, title: string) => {
            const notes = await readStdin()
            const params: Record<string, string> = { title }
            if (area) params.area = area
            if (when) params.when = when
            if (deadline) params.deadline = deadline
            if (notes) params.notes = notes
            await openThingsUrl('add-project', params)
          }),
      ),
  )
  // The Things URL scheme also supports creation-date and completion-date on
  // update, but creation-date can only move backward. To move it forward, use
  // an Apple Shortcut with "Set Creation Date".
  .command(
    'update',
    new Command()
      .description('update an existing item via Things URL scheme')
      .arguments('<uuid:string>')
      .option('--title <title:string>', 'new title')
      .option('--notes <notes:string>', 'replace notes')
      .option('--prepend-notes <prependNotes:string>', 'prepend to notes')
      .option('--append-notes <appendNotes:string>', 'append to notes')
      .option(
        '--when <when:string>',
        'today, tomorrow, evening, anytime, someday, or date',
      )
      .option('--deadline <deadline:string>', 'deadline date')
      .option('--completed', 'mark completed')
      .option('--canceled', 'mark canceled')
      .option('--add-tags <addTags:string>', 'comma-separated tags')
      .action(
        async (
          {
            title,
            notes,
            prependNotes,
            appendNotes,
            when,
            deadline,
            completed,
            canceled,
            addTags,
          },
          uuid: string,
        ) => {
          const token = requireToken()
          const params: Record<string, string> = { id: uuid, 'auth-token': token }
          if (title) params.title = title
          if (notes) params.notes = notes
          if (prependNotes) params['prepend-notes'] = prependNotes
          if (appendNotes) params['append-notes'] = appendNotes
          if (when) params.when = when
          if (deadline) params.deadline = deadline
          if (completed) params.completed = 'true'
          if (canceled) params.canceled = 'true'
          if (addTags) params['add-tags'] = addTags
          await openThingsUrl('update', params)
        },
      ),
  )
  .parse(Deno.args)
