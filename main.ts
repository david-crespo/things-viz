#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import process from 'node:process'
import { text } from 'node:stream/consumers'
import { styleText } from 'node:util'
import memoize from 'memoize'
import { match } from 'ts-pattern'
import { Command, InvalidArgumentError, Option } from '@commander-js/extra-typings'

import {
  type CountRow,
  findDatabasePath,
  getAllItems,
  getAreas,
  getCounts,
  getItemByUuid,
  getProjectByUuid,
  getProjects,
  getTodoByUuid,
  getViewItems,
  NO_AREA,
  type Project,
  type Todo,
  type ViewName,
} from './data.ts'
import { plotSeries, renderPlotHtml } from './plot.ts'

// Found on first use, so commands that never read the database work without one
const dbPath = memoize(findDatabasePath)

if (!import.meta.main) process.exit()

// Fills in only variables that aren't already set. An empty value counts as set, which
// test/cli.ts relies on.
try {
  process.loadEnvFile(`${import.meta.dirname}/.env`)
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}

function requireToken(): string {
  const token = process.env.THINGS_TOKEN
  if (!token) {
    console.error('THINGS_TOKEN required. Set it in env or .env file.')
    process.exit(1)
  }
  return token
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const buf = await text(process.stdin)
  return buf.trimEnd()
}

// Run a command to completion. Rejects only if it can't be started.
function run(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (!error) return resolve({ code: 0, stderr })
      // A number is the exit code; a string like ENOENT means it never ran
      if (typeof error.code !== 'number') return reject(error)
      resolve({ code: error.code, stderr })
    })
  })
}

async function openThingsUrl(action: string, params: Record<string, string>) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const urlStr = `things:///${action}?${query}`
  const displayQuery = Object.entries(params)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${k === 'auth-token' ? '***' : encodeURIComponent(v)}`,
    )
    .join('&')
  console.error(`things:///${action}?${displayQuery}`)
  const { code } = await run('open', [urlStr])
  if (code !== 0) {
    console.error(`Failed to open URL (exit code ${code})`)
    process.exit(1)
  }
}

const FORMATS = ['short', 'pretty', 'json', 'tsv'] as const
type RenderFormat = (typeof FORMATS)[number]

const formatOption = (defaultFormat: RenderFormat = 'short') =>
  new Option('-f, --format <format>', 'output format')
    .choices(FORMATS)
    .default(defaultFormat)

function parseInteger(value: string) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new InvalidArgumentError('Not an integer.')
  return n
}

// For repeatable options
const collect = (value: string, previous: string[] = []) => [...previous, value]

function renderCountsTable(counts: CountRow[]) {
  if (counts.length === 0) return
  const showUnassigned = counts.some(({ unassigned }) => unassigned > 0)
  // Areas can be named like the synthetic columns; suffix them so the columns stay distinct
  const usedHeaders = new Set(['date', 'Total', 'Completions', NO_AREA])
  const areaColumns = [...new Set(counts.flatMap(({ areas }) => Object.keys(areas)))]
    .sort()
    .map((name) => {
      let header = name
      let suffix = 1
      while (usedHeaders.has(header)) {
        header = suffix === 1 ? `${name} (area)` : `${name} (area ${suffix})`
        suffix++
      }
      usedHeaders.add(header)
      return { name, header }
    })
  const headers = [
    'date',
    'Total',
    'Completions',
    ...(showUnassigned ? [NO_AREA] : []),
    ...areaColumns.map(({ header }) => header),
  ]
  const rows = counts.map((count) => [
    count.date,
    String(count.total),
    String(count.completions),
    ...(showUnassigned ? [String(count.unassigned)] : []),
    ...areaColumns.map(({ name }) => String(count.areas[name] ?? '')),
  ])
  const widths = headers.map((_, i) =>
    Math.max(...[headers, ...rows].map((row) => row[i].length)),
  )
  for (const row of [headers, ...rows]) {
    console.log(
      row
        .map((cell, i) => cell.padEnd(widths[i]))
        .join(' ')
        .trimEnd(),
    )
  }
}

function renderTsv(headers: string[], rows: (string | null | undefined)[][]) {
  const escape = (v: string | null | undefined) => (v ?? '').replace(/[\t\n\r]/g, ' ')
  console.log(headers.join('\t'))
  rows.forEach((row) => console.log(row.map(escape).join('\t')))
}

// Local-time YYYY-MM-DD HH:MM for human-readable output. Things stores stopDate
// (and creation/modification) as unix timestamps with second precision, so the
// time is meaningful — e.g. for sorting completions within a day.
function fmtLocalDateTime(d: Date): string {
  const dt = Temporal.Instant.fromEpochMilliseconds(d.getTime())
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
  return dt.replace('T', ' ')
}

// Local-time YYYY-MM-DD for timestamps (not for date-only fields like start_date and
// deadline, which are parsed as UTC midnight and must be printed back in UTC).
function fmtLocalDate(d: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(d.getTime())
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDate()
    .toString()
}

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
    todo.stop_date ? `${doneLabel}: ${fmtLocalDateTime(todo.stop_date)}` : null,
    todo.evening ? 'evening' : null,
    // Suppress the start bucket (e.g. "someday") when a scheduled date is
    // present — the bucket is a Things implementation detail, and the date
    // already tells the user when the item will appear.
    todo.start !== 'Anytime' && !todo.start_date ? todo.start.toLowerCase() : null,
    todo.start_date ? `scheduled: ${todo.start_date.toISOString().slice(0, 10)}` : null,
    todo.deadline ? `deadline: ${todo.deadline.toISOString().slice(0, 10)}` : null,
  ].filter((s): s is string => s !== null)
}

function renderProject(project: Project, format: RenderFormat) {
  const fmtDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
  match(format)
    .with('json', () => {
      console.log(
        JSON.stringify(
          {
            uuid: project.uuid,
            type: 'project',
            title: project.title,
            status: project.status,
            area: project.area_title,
            notes: project.notes,
            start: project.start,
            start_date: fmtDate(project.start_date),
            deadline: fmtDate(project.deadline),
            created: project.created.toISOString(),
          },
          null,
          2,
        ),
      )
    })
    .with('pretty', () => {
      console.log(`[Project] ${project.title}`)
      const tags = [
        `area: ${project.area_title}`,
        project.start_date ? `scheduled: ${fmtDate(project.start_date)}` : null,
        project.deadline ? `deadline: ${fmtDate(project.deadline)}` : null,
      ].filter(Boolean)
      console.log(`  ${tags.join(' | ')}`)
      if (project.notes) {
        console.log(`  ${project.notes.replace(/\n/g, '\n  ')}`)
      }
    })
    .with('short', 'tsv', () => console.log(`[Project] ${project.title}`))
    .exhaustive()
}

function renderTodos(todos: Todo[], format: RenderFormat, showArea = true) {
  match(format)
    .with('json', () => {
      console.log(
        JSON.stringify(
          todos.map((todo) => ({
            uuid: todo.uuid,
            title: todo.title,
            status: todo.status,
            area: todo.area_title,
            project: todo.project_title || null,
            heading: todo.heading_title || null,
            notes: todo.notes || null,
            created: todo.created.toISOString(),
            modified: todo.modified?.toISOString() || null,
            stop_date: todo.stop_date?.toISOString() || null,
            start: todo.start,
            evening: todo.evening,
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
        fmtLocalDateTime(todo.created),
        todo.stop_date ? fmtLocalDateTime(todo.stop_date) : null,
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
          `created: ${fmtLocalDate(todo.created)}`,
          todo.modified ? `modified: ${fmtLocalDate(todo.modified)}` : null,
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

const style = (format: Parameters<typeof styleText>[0], str: string) =>
  styleText(format, str, { validateStream: false })

const program = new Command()
  .name('tviz')
  .description('Visualize Things 3 data')
  .helpCommand(false)
  // Subcommands made with .command() copy these. Commander strips the colors when the
  // output isn't a terminal or NO_COLOR is set, so styleText doesn't need to check.
  .configureHelp({
    styleTitle: (str) => style('bold', str),
    styleOptionText: (str) => style('blueBright', str),
    styleSubcommandText: (str) => style('blueBright', str),
    styleArgumentText: (str) => style('magentaBright', str),
  })
  .configureOutput({ outputError: (str, write) => write(style('red', str)) })

program
  .command('table')
  .description('print table of the last 30 days')
  .action(async () => {
    renderCountsTable(getCounts({ dbPath: await dbPath() }).slice(-30))
  })

program
  .command('plot')
  .description('run server showing plot')
  .action(() => {
    const hostname = '0.0.0.0'
    const port = 8000
    const url = `http://${hostname}:${port}`
    const plotTemplate = readFileSync(`${import.meta.dirname}/plot.html`, 'utf8')

    const server = createServer(async (_req, res) => {
      try {
        const counts = getCounts({ dbPath: await dbPath() })
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(renderPlotHtml(plotTemplate, plotSeries(counts)))
      } catch (e) {
        console.error(e)
        res.writeHead(500).end()
      }
    })
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EADDRINUSE') throw e
      console.error(`Server already running at ${url}. Opening...`)
      // still open it
      spawn('open', [url], { stdio: 'ignore' })
    })
    server.listen(port, hostname, () => {
      console.log(`Listening on ${url}`)
      spawn('open', [url], { stdio: 'ignore' })
    })
  })

program
  .command('logbook')
  .description('list completed items')
  .option('-a, --area <area>', 'filter by area name')
  .option('-n, --limit <limit>', 'max items to show', parseInteger, 50)
  .addOption(formatOption())
  .action(async ({ area, limit, format }) => {
    let todos = getAllItems({ dbPath: await dbPath() }).filter(
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

program
  .command('todos')
  .description('list items')
  .option('-a, --area <area>', 'filter by area name')
  .option('-p, --project <project>', 'filter by project name')
  .option('-s, --search <text>', 'search in title and notes')
  .option('-d, --deadline', 'only show items with deadlines')
  .option('-r, --recent <days>', 'only show items modified in last N days', parseInteger)
  .option('-c, --completed', 'show only completed items')
  .option('--all', 'show all items regardless of status')
  .addOption(formatOption())
  .action(async (options) => {
    const incompleteOnly = !options.completed && !options.all
    let todos = getAllItems({ incompleteOnly, dbPath: await dbPath() })
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
        todo.project_title?.toLowerCase().includes(options.project!.toLowerCase()),
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

program
  .command('areas')
  .description('list all areas')
  .addOption(formatOption('pretty'))
  .action(async ({ format }) => {
    const areas = getAreas({ dbPath: await dbPath() })
    match(format)
      .with('json', () => console.log(JSON.stringify(areas, null, 2)))
      .with('tsv', () =>
        renderTsv(
          ['area'],
          areas.map((a) => [a]),
        ),
      )
      .with('short', 'pretty', () => areas.forEach((a) => console.log(a)))
      .exhaustive()
  })

program
  .command('projects')
  .description('list projects')
  .option('-a, --area <area>', 'filter by area name')
  .option('-c, --completed', 'show only completed projects')
  .option('--all', 'show all projects regardless of status')
  .addOption(formatOption('pretty'))
  .action(async ({ area, completed, all, format }) => {
    let projects = getProjects({ dbPath: await dbPath() })
    if (completed) {
      projects = projects.filter((p) => p.status === 'completed')
    } else if (!all) {
      projects = projects.filter((p) => p.status === 'incomplete')
    }
    if (area) {
      projects = projects.filter((p) => p.area_title.toLowerCase() === area!.toLowerCase())
    }
    projects.sort((a, b) =>
      `${a.area_title}${a.title}`.localeCompare(`${b.area_title}${b.title}`),
    )
    const fmtDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
    match(format)
      .with('json', () => {
        console.log(
          JSON.stringify(
            projects.map((p) => ({
              uuid: p.uuid,
              area: p.area_title,
              project: p.title,
              start: p.start,
              start_date: fmtDate(p.start_date),
              deadline: fmtDate(p.deadline),
              created: p.created?.toISOString() || null,
            })),
            null,
            2,
          ),
        )
      })
      .with('tsv', () => {
        renderTsv(
          ['uuid', 'area', 'project', 'when', 'start_date', 'deadline', 'created'],
          projects.map((p) => [
            p.uuid,
            p.area_title,
            p.title,
            p.start,
            fmtDate(p.start_date),
            fmtDate(p.deadline),
            fmtLocalDate(p.created),
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

const views: [ViewName, string][] = [
  ['today', 'list tasks in Today view'],
  ['inbox', 'list tasks in Inbox'],
  ['anytime', 'list tasks in Anytime view (no schedule, ready to do)'],
  ['upcoming', 'list tasks in Upcoming view (scheduled for future)'],
  ['someday', 'list tasks in Someday view (deferred)'],
]
for (const [view, description] of views) {
  program
    .command(view)
    .description(description)
    .addOption(formatOption())
    .action(async ({ format }) =>
      renderTodos(getViewItems(view, { dbPath: await dbPath() }), format),
    )
}

program
  .command('link')
  .description('output OSC 8 hyperlink for a Things item')
  .argument('<uuid>')
  .action(async (uuid) => {
    const item = getItemByUuid(uuid, { dbPath: await dbPath() })
    if (!item) {
      console.error(`Item not found: ${uuid}`)
      process.exit(1)
    }
    const url = `things:///show?id=${uuid}`
    console.log(`\x1b]8;;${url}\x1b\\\x1b[34m${item.title}\x1b[0m\x1b]8;;\x1b\\`)
  })

program
  .command('item')
  .description('show a single item by uuid')
  .argument('<uuid>')
  .addOption(formatOption())
  .action(async (uuid, { format }) => {
    const item = getItemByUuid(uuid, { dbPath: await dbPath() })
    if (!item) {
      console.error(`Item not found: ${uuid}`)
      process.exit(1)
    }
    await match(item)
      .with({ type: 'to-do' }, async () => {
        renderTodos([getTodoByUuid(uuid, { dbPath: await dbPath() })!], format)
      })
      .with({ type: 'project' }, async () => {
        renderProject(getProjectByUuid(uuid, { dbPath: await dbPath() })!, format)
      })
      .with({ type: 'area' }, ({ title }) => console.log(`[Area] ${title}`))
      .with({ type: 'heading' }, ({ title, project_title }) => {
        const project = project_title ? ` (project: ${project_title})` : ''
        console.log(`[Heading] ${title}${project}`)
      })
      .exhaustive()
  })

const add = program.command('add').description('create items via Things URL scheme')

add
  .command('todo')
  .description('create a new todo')
  .argument('<title>')
  .addOption(new Option('--area <area>', 'area name').conflicts('project'))
  .option('--project <project>', 'project name')
  .option('--heading <heading>', 'heading within project')
  .option('--when <when>', 'today, tomorrow, evening, anytime, someday, or date')
  .option('--deadline <deadline>', 'deadline date')
  .option('--checklist <item>', 'checklist item (repeatable, max 100)', collect)
  .action(async (title, { area, project, heading, when, deadline, checklist }) => {
    const notes = await readStdin()
    const params: Record<string, string> = { title }
    if (area) params.list = area
    if (project) params.list = project
    if (heading) params.heading = heading
    if (when) params.when = when
    if (deadline) params.deadline = deadline
    if (notes) params.notes = notes
    if (checklist) params['checklist-items'] = checklist.join('\n')
    await openThingsUrl('add', params)
  })

add
  .command('project')
  .description('create a new project')
  .argument('<title>')
  .option('--area <area>', 'area name')
  .option('--when <when>', 'today, tomorrow, evening, anytime, someday, or date')
  .option('--deadline <deadline>', 'deadline date')
  .option('--heading <heading>', 'heading to create (repeatable)', collect)
  .action(async (title, { area, when, deadline, heading }) => {
    const notes = await readStdin()
    if (heading) {
      // Headings can only be created together with the project. The URL scheme has
      // no operation for adding one to an existing project.
      const attributes: Record<string, unknown> = { title }
      if (area) attributes.area = area
      if (when) attributes.when = when
      if (deadline) attributes.deadline = deadline
      if (notes) attributes.notes = notes
      attributes.items = heading.map((h) => ({
        type: 'heading',
        attributes: { title: h },
      }))
      await openThingsUrl('json', {
        data: JSON.stringify([{ type: 'project', attributes }]),
      })
      return
    }
    const params: Record<string, string> = { title }
    if (area) params.area = area
    if (when) params.when = when
    if (deadline) params.deadline = deadline
    if (notes) params.notes = notes
    await openThingsUrl('add-project', params)
  })

// The URL scheme has no delete, so this goes through Things' AppleScript
// dictionary instead. Deletion moves the item to Things' Trash, which the app
// empties on its own schedule, so it is recoverable from the app for a while.
program
  .command('delete')
  .description('move an item to the Things trash')
  .argument('<uuid>')
  .action(async (uuid) => {
    const item = getItemByUuid(uuid, { dbPath: await dbPath() })
    if (!item) {
      console.error(`Item not found: ${uuid}`)
      process.exit(1)
    }
    // Open items resolve by bare id; completed and canceled ones only resolve
    // when scoped to the Logbook list.
    const scope = (status: string) => (status === 'incomplete' ? '' : ' of list "Logbook"')
    const target = match(item)
      .with({ type: 'area' }, () => {
        console.error('Refusing to delete an area')
        return process.exit(1)
      })
      .with({ type: 'heading' }, () => {
        console.error('Refusing to delete a heading')
        return process.exit(1)
      })
      .with({ type: 'project' }, ({ status }) => `project id "${uuid}"${scope(status)}`)
      .with({ type: 'to-do' }, ({ status }) => `to do id "${uuid}"${scope(status)}`)
      .exhaustive()
    const script = `tell application "Things3" to delete ${target}`
    console.error(`osascript -e '${script}'`)
    const { code, stderr } = await run('osascript', ['-e', script])
    if (code !== 0) {
      console.error(stderr.trimEnd())
      console.error(`Failed to delete (exit code ${code})`)
      process.exit(1)
    }
    console.log(`Deleted: ${item.title}`)
  })

// The Things URL scheme also supports creation-date and completion-date on
// update, but creation-date can only move backward. To move it forward, use
// an Apple Shortcut with "Set Creation Date".
program
  .command('update')
  .description('update an existing item via Things URL scheme')
  .argument('<uuid>')
  .option('--title <title>', 'new title')
  .option('--notes <notes>', 'replace notes')
  .option('--prepend-notes <prependNotes>', 'prepend to notes')
  .option('--append-notes <appendNotes>', 'append to notes')
  .option('--when <when>', 'today, tomorrow, evening, anytime, someday, or date')
  .option('--deadline <deadline>', 'deadline date')
  .option('--heading <heading>', 'move under heading within project')
  .option('--completed', 'mark completed')
  .option('--canceled', 'mark canceled')
  .option('--add-tags <addTags>', 'comma-separated tags')
  .option('--checklist <item>', 'replace checklist items (repeatable, max 100)', collect)
  .option('--append-checklist <item>', 'append checklist items (repeatable)', collect)
  .option('--prepend-checklist <item>', 'prepend checklist items (repeatable)', collect)
  .action(
    async (
      uuid,
      {
        title,
        notes,
        prependNotes,
        appendNotes,
        when,
        deadline,
        heading,
        completed,
        canceled,
        addTags,
        checklist,
        appendChecklist,
        prependChecklist,
      },
    ) => {
      const token = requireToken()
      const item = getItemByUuid(uuid, { dbPath: await dbPath() })
      if (!item) {
        console.error(`Item not found: ${uuid}`)
        process.exit(1)
      }
      // The URL scheme can only update to-dos and projects
      const action = match(item)
        .with({ type: 'area' }, () => {
          console.error('Refusing to update an area')
          return process.exit(1)
        })
        .with({ type: 'heading' }, () => {
          console.error('Refusing to update a heading')
          return process.exit(1)
        })
        .with({ type: 'project' }, () => 'update-project')
        .with({ type: 'to-do' }, () => 'update')
        .exhaustive()
      const params: Record<string, string> = { id: uuid, 'auth-token': token }
      if (title) params.title = title
      // An empty value clears the field
      if (notes !== undefined) params.notes = notes
      // Auto-separate from existing notes with a line break. Things 3
      // doesn't render markdown, so visual separation matters. With no
      // existing notes, a separator would just be a leading line break,
      // but prepended and appended text still need one between them.
      const sep = 'notes' in item && item.notes?.trim() ? '\n' : ''
      if (prependNotes) params['prepend-notes'] = prependNotes + sep
      if (appendNotes) {
        params['append-notes'] = (sep || (prependNotes ? '\n' : '')) + appendNotes
      }
      if (when) params.when = when
      if (deadline !== undefined) params.deadline = deadline
      if (heading) params.heading = heading
      if (completed) params.completed = 'true'
      if (canceled) params.canceled = 'true'
      if (addTags) params['add-tags'] = addTags
      if (checklist) params['checklist-items'] = checklist.join('\n')
      if (appendChecklist) {
        params['append-checklist-items'] = appendChecklist.join('\n')
      }
      if (prependChecklist) {
        params['prepend-checklist-items'] = prependChecklist.join('\n')
      }
      await openThingsUrl(action, params)
    },
  )

await program.parseAsync()
