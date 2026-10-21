import { DatabaseSync } from 'node:sqlite'
import { expandGlob } from '@std/fs/expand-glob'
import dayjs from 'dayjs'
import memoize from 'memoize'
import { z } from 'zod'

export const NO_AREA = 'No area'

// Zod schemas for runtime validation
const status = z.enum(['incomplete', 'completed', 'canceled'])

const checklistItemSchema = z.object({
  type: z.literal('checklist-item'),
  uuid: z.string(),
  title: z.string(),
  status,
  created: z.string().nullable(),
  modified: z.string().nullable(),
  // when the item was completed or canceled
  stop_date: z.string().nullable(),
})

const itemBase = z.object({
  uuid: z.string(),
  title: z.string(),
  status,
  created: z.string(),
  modified: z.string().nullable(),
  // scheduling bucket: "Inbox", "Anytime", or "Someday"
  start: z.string(),
  // true if the item is marked as evening in Things
  evening: z.boolean(),
  // user-set scheduled date (when item should appear in Today)
  start_date: z.string().nullable(),
  // user-set due date
  deadline: z.string().nullable(),
  // when the item was completed or canceled (used to reconstruct historical open counts)
  stop_date: z.string().nullable(),
  notes: z.string().optional(),
  area: z.string().optional(),
  area_title: z.string().nullable().optional(),
})

const todoSchema = itemBase.extend({
  type: z.literal('to-do'),
  checklist: z.array(checklistItemSchema).optional(),
  project: z.string().optional(),
  project_title: z.string().optional(),
  heading: z.string().optional(),
  heading_title: z.string().optional(),
})

const projectSchema = itemBase.extend({ type: z.literal('project') })

const areaSchema = z.object({
  type: z.literal('area'),
  uuid: z.string(),
  title: z.string(),
})

const headingSchema = z.object({
  type: z.literal('heading'),
  uuid: z.string(),
  title: z.string(),
  project: z.string().optional(),
  project_title: z.string().optional(),
})

const anyItemSchema = z.union([todoSchema, projectSchema, areaSchema, headingSchema])

// Database path discovery
export async function findDatabasePath(): Promise<string> {
  const envPath = Deno.env.get('THINGSDB')
  if (envPath) return envPath

  const pattern =
    '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite'.replace(
      '~',
      Deno.env.get('HOME') || '',
    )

  for await (const entry of expandGlob(pattern)) {
    return entry.path
  }
  throw new Error('Things database not found')
}

// Date conversions - output string format for zod validation
const pad2 = (n: number) => String(n).padStart(2, '0')

function thingsDateToIso(td: number | null): string | null {
  if (!td) return null
  const year = (td >> 16) & 0x7ff
  const month = (td >> 12) & 0xf
  const day = (td >> 7) & 0x1f
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function unixToDatetime(ts: number | null): string | null {
  if (!ts) return null
  return new Date(Math.floor(ts) * 1000).toISOString()
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  return new Date(s)
}

const STATUS_MAP: Record<number, string> = {
  0: 'incomplete',
  2: 'canceled',
  3: 'completed',
}
const START_MAP: Record<number, string> = { 0: 'Inbox', 1: 'Anytime', 2: 'Someday' }
const TYPE_MAP: Record<number, string> = { 0: 'to-do', 1: 'project', 2: 'heading' }

type Row = Record<string, unknown>

function transformTask(row: Row): Record<string, unknown> {
  const result: Record<string, unknown> = {
    uuid: row.uuid,
    type: TYPE_MAP[row.type as number] ?? row.type,
    title: row.title,
    status: STATUS_MAP[row.status as number] ?? row.status,
  }

  if (row.area) {
    result.area = row.area
    result.area_title = row.area_title
  }
  if (row.project) {
    result.project = row.project
    result.project_title = row.project_title
  }
  if (row.heading) {
    result.heading = row.heading
    result.heading_title = row.heading_title
  }

  result.notes = row.notes ?? ''
  result.start = START_MAP[row.start as number] ?? row.start
  result.evening = (row.startBucket as number) === 1
  result.start_date = thingsDateToIso(row.startDate as number | null)
  result.deadline = thingsDateToIso(row.deadline as number | null)
  result.stop_date = unixToDatetime(row.stopDate as number | null)
  result.created = unixToDatetime(row.creationDate as number | null)
  result.modified = unixToDatetime(row.userModificationDate as number | null)

  return result
}

function transformArea(row: Row): Record<string, unknown> {
  return {
    type: 'area',
    uuid: row.uuid,
    title: row.title,
  }
}

// userModificationDate for both created and modified matches things.py behavior:
// https://github.com/thingsapi/things.py/blob/d5b27343/things/database.py#L415-L418
function transformChecklistItem(row: Row): Record<string, unknown> {
  return {
    type: 'checklist-item',
    uuid: row.uuid,
    title: row.title,
    status: STATUS_MAP[row.status as number] ?? row.status,
    created: unixToDatetime(row.userModificationDate as number | null),
    modified: unixToDatetime(row.userModificationDate as number | null),
    stop_date: unixToDatetime(row.stopDate as number | null),
  }
}

function isoToThingsDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (y << 16) | (m << 12) | (d << 7)
}

function localDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Convert validated zod todo to final typed format
function parseTodo(item: z.infer<typeof todoSchema>) {
  return {
    ...item,
    evening: item.evening,
    created: parseDate(item.created)!,
    modified: parseDate(item.modified),
    start_date: parseDate(item.start_date),
    deadline: parseDate(item.deadline),
    stop_date: parseDate(item.stop_date),
    area_title: item.area_title ?? NO_AREA,
  }
}

// SQL fragments for todo queries
const TODO_COLS = `
  t.uuid, t.type, t.title, t.status,
  t.area, a.title as area_title,
  COALESCE(t.project, h.project) as project,
  COALESCE(p.title, hp.title) as project_title,
  t.heading, h.title as heading_title,
  t.notes, t.start, t.startDate, t.startBucket, t.deadline, t.stopDate,
  t.creationDate, t.userModificationDate, t."index" as idx, t.todayIndex`

const TODO_FROM = `
  FROM TMTask t
  LEFT JOIN TMArea a ON t.area = a.uuid
  LEFT JOIN TMTask p ON t.project = p.uuid
  LEFT JOIN TMTask h ON t.heading = h.uuid
  LEFT JOIN TMTask hp ON h.project = hp.uuid`

// Excludes trashed items and recurring tasks, ensures parent project/heading not trashed
const TODO_BASE_WHERE = `
  t.type = 0 AND t.trashed = 0
  AND t.rt1_recurrenceRule IS NULL
  AND (t.project IS NULL OR p.trashed = 0)
  AND (t.heading IS NULL OR h.trashed = 0)
  AND (h.project IS NULL OR hp.trashed = 0)`

class Things {
  private db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true })
  }

  [Symbol.dispose]() {
    this.db.close()
  }

  areas(): Row[] {
    return this.db
      .prepare(`SELECT uuid, title FROM TMArea ORDER BY "index"`)
      .all()
      .map((row) => transformArea(row as Row))
  }

  projects(): Row[] {
    return this.db
      .prepare(
        `SELECT
          t.uuid, t.type, t.title, t.status,
          t.area, a.title as area_title,
          t.notes, t.start, t.startDate, t.deadline, t.stopDate,
          t.creationDate, t.userModificationDate, t."index" as idx, t.todayIndex
        FROM TMTask t
        LEFT JOIN TMArea a ON t.area = a.uuid
        WHERE t.type = 1 AND t.trashed = 0
        ORDER BY t."index"`,
      )
      .all()
      .map((row) => transformTask(row as Row))
  }

  todos(options: { status?: string } = {}): Row[] {
    const statusVal =
      options.status === 'completed' ? 3 : options.status === 'canceled' ? 2 : 0

    return this.db
      .prepare(
        `SELECT ${TODO_COLS} ${TODO_FROM}
        WHERE ${TODO_BASE_WHERE} AND t.status = ?
        ORDER BY t."index"`,
      )
      .all(statusVal)
      .map((row) => transformTask(row as Row))
  }

  today(): Row[] {
    // start IN (1, 2) picks up both confirmed (Anytime) and unconfirmed
    // (Someday) items whose scheduled date has arrived. Unconfirmed items
    // show a yellow dot in the Things UI. Undated items in any bucket also
    // show up once their deadline arrives, unless the deadline was suppressed
    // (things.py's unconfirmed_overdue_tasks):
    // https://github.com/thingsapi/things.py/blob/f228e5e/things/api.py#L515-L520
    const today = isoToThingsDate(localDateStr())
    return this.db
      .prepare(
        `SELECT ${TODO_COLS} ${TODO_FROM}
        WHERE ${TODO_BASE_WHERE}
          AND t.status = 0
          AND (
            (t.start IN (1, 2) AND t.startDate IS NOT NULL AND t.startDate <= ?)
            OR (t.startDate IS NULL AND t.deadline <= ?
              AND t.deadlineSuppressionDate IS NULL)
          )
        ORDER BY t.todayIndex`,
      )
      .all(today, today)
      .map((row) => transformTask(row as Row))
  }

  inbox(): Row[] {
    return this.queryView('t.start = 0')
  }

  anytime(): Row[] {
    return this.queryView('t.start = 1')
  }

  upcoming(): Row[] {
    return this.db
      .prepare(
        `SELECT ${TODO_COLS} ${TODO_FROM}
        WHERE ${TODO_BASE_WHERE}
          AND t.status = 0 AND t.start = 2 AND t.startDate > ?
        ORDER BY t."index"`,
      )
      .all(isoToThingsDate(localDateStr()))
      .map((row) => transformTask(row as Row))
  }

  someday(): Row[] {
    return this.queryView('t.start = 2 AND (t.startDate IS NULL OR t.startDate = 0)')
  }

  private queryView(extraWhere: string): Row[] {
    return this.db
      .prepare(
        `SELECT ${TODO_COLS} ${TODO_FROM}
        WHERE ${TODO_BASE_WHERE} AND t.status = 0 AND ${extraWhere}
        ORDER BY t."index"`,
      )
      .all()
      .map((row) => transformTask(row as Row))
  }

  attachChecklistItems(tasks: Row[]): Row[] {
    const uuids = tasks.map((t) => t.uuid as string)
    if (uuids.length === 0) return tasks

    const placeholders = uuids.map(() => '?').join(',')
    const items = this.db
      .prepare(
        `SELECT task, uuid, title, status, creationDate, userModificationDate, stopDate
        FROM TMChecklistItem
        WHERE task IN (${placeholders})
        ORDER BY task, "index"`,
      )
      .all(...uuids)

    const byTask = new Map<string, Row[]>()
    for (const row of items) {
      const taskUuid = (row as Row).task as string
      if (!byTask.has(taskUuid)) byTask.set(taskUuid, [])
      byTask.get(taskUuid)!.push(transformChecklistItem(row as Row))
    }

    for (const task of tasks) {
      const taskItems = byTask.get(task.uuid as string)
      if (taskItems && taskItems.length > 0) {
        task.checklist = taskItems
      }
    }
    return tasks
  }

  get(uuid: string): Row | null {
    const task = this.db
      .prepare(
        `SELECT
          t.uuid, t.type, t.title, t.status,
          t.area, a.title as area_title,
          COALESCE(t.project, h.project) as project,
          COALESCE(p.title, hp.title) as project_title,
          t.heading, h.title as heading_title,
          t.notes, t.start, t.startDate, t.startBucket, t.deadline, t.stopDate,
          t.creationDate, t.userModificationDate, t."index" as idx, t.todayIndex
        FROM TMTask t
        LEFT JOIN TMArea a ON t.area = a.uuid
        LEFT JOIN TMTask p ON t.project = p.uuid
        LEFT JOIN TMTask h ON t.heading = h.uuid
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.uuid = ?`,
      )
      .get(uuid)

    if (task) return transformTask(task as Row)

    const area = this.db.prepare(`SELECT uuid, title FROM TMArea WHERE uuid = ?`).get(uuid)
    if (area) return transformArea(area as Row)

    return null
  }
}

// Resolve area_title for items that have a project but no direct area
function resolveAreas(items: Row[], things: Things): Row[] {
  const needsLookup = items.filter((i) => i.project && !i.area_title)
  if (needsLookup.length === 0) return items

  const projects = new Map(things.projects().map((project) => [project.uuid, project]))
  for (const item of needsLookup) {
    const project = projects.get(item.project as string)
    if (project?.area) item.area = project.area
    item.area_title = project?.area_title ?? null
  }
  return items
}

// Public API

type DatabaseOptions = { dbPath: string; timeZone?: string }

export function getAllItems(opts: { incompleteOnly?: boolean; dbPath: string }) {
  using things = new Things(opts.dbPath)
  let items = things.todos({ status: 'incomplete' })
  if (!opts.incompleteOnly) {
    items = [
      ...items,
      ...things.todos({ status: 'completed' }),
      ...things.todos({ status: 'canceled' }),
    ]
  }
  things.attachChecklistItems(items)
  const resolved = resolveAreas(items, things)
  const parsed = z.array(todoSchema).parse(resolved)
  return parsed.map(parseTodo)
}

export function getItemByUuid(uuid: string, opts: DatabaseOptions) {
  using things = new Things(opts.dbPath)
  const result = things.get(uuid)
  if (!result) return null
  return anyItemSchema.parse(result)
}

export function getTodoByUuid(uuid: string, opts: DatabaseOptions): Todo | null {
  using things = new Things(opts.dbPath)
  const result = things.get(uuid)
  if (!result || result.type !== 'to-do') return null
  things.attachChecklistItems([result])
  const resolved = resolveAreas([result], things)
  const parsed = todoSchema.parse(resolved[0])
  return parseTodo(parsed)
}

export function getAreas(opts: DatabaseOptions) {
  using things = new Things(opts.dbPath)
  const areas = z.array(areaSchema).parse(things.areas())
  return areas.map((a) => a.title).sort()
}

function parseProject(p: z.infer<typeof projectSchema>) {
  return {
    uuid: p.uuid,
    title: p.title,
    status: p.status,
    area_title: p.area_title ?? NO_AREA,
    notes: p.notes?.trim() || null,
    start: p.start,
    start_date: parseDate(p.start_date),
    deadline: parseDate(p.deadline),
    created: parseDate(p.created)!,
  }
}

export function getProjects(opts: DatabaseOptions) {
  using things = new Things(opts.dbPath)
  return z.array(projectSchema).parse(things.projects()).map(parseProject)
}

export function getProjectByUuid(uuid: string, opts: DatabaseOptions) {
  using things = new Things(opts.dbPath)
  const result = things.get(uuid)
  if (!result || result.type !== 'project') return null
  return parseProject(projectSchema.parse(result))
}

export type ViewName = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'
export type Todo = Awaited<ReturnType<typeof getAllItems>>[number]
export type Project = Awaited<ReturnType<typeof getProjects>>[number]
export type Item = NonNullable<Awaited<ReturnType<typeof getItemByUuid>>>

export function getViewItems(view: ViewName, opts: DatabaseOptions) {
  using things = new Things(opts.dbPath)
  const items = things[view]()
  things.attachChecklistItems(items)
  const resolved = resolveAreas(items, things)
  const parsed = z.array(todoSchema).parse(resolved)
  return parsed.map(parseTodo)
}

export type CountRow = {
  date: string
  total: number
  completions: number
  unassigned: number
  areas: Record<string, number>
}

export type CountPlotDatum = {
  date: string
  kind: 'total' | 'completions' | 'completion-average' | 'unassigned' | 'area'
  area: string
  label: string
  count: number
}

export function countsToPlotData(counts: CountRow[]): CountPlotDatum[] {
  return counts.flatMap(({ date, total, completions, unassigned, areas }) => [
    { date, kind: 'total', area: 'total', label: 'Total', count: total },
    {
      date,
      kind: 'completions',
      area: 'completions',
      label: 'Completions',
      count: completions,
    },
    { date, kind: 'unassigned', area: 'unassigned', label: NO_AREA, count: unassigned },
    ...Object.entries(areas)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({
        date,
        kind: 'area' as const,
        area: `area:${name}`,
        label: name,
        count,
      })),
  ])
}

export function getCounts(opts: DatabaseOptions) {
  const todos = getAllItems(opts)
  const timeZone = opts.timeZone ?? Temporal.Now.timeZoneId()
  const dateToStr = (date: Date) =>
    Temporal.Instant.fromEpochMilliseconds(date.getTime())
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .toString()

  const incrDay = memoize((d: string) => dayjs(d).add(1, 'days').format('YYYY-MM-DD'))

  const today = dateToStr(new Date())

  type DateCounts = Omit<CountRow, 'date'>
  const counts: Record<string, DateCounts> = {}

  const initCounts = (): DateCounts => ({
    total: 0,
    completions: 0,
    unassigned: 0,
    areas: {},
  })

  for (const item of todos) {
    const start = dateToStr(item.created)
    // Open items run through today, so the last row is today's (likely partial) count
    const end = item.stop_date ? dateToStr(item.stop_date) : today

    for (let date = start; date <= end; date = incrDay(date)) {
      const dateCounts = counts[date] || initCounts()
      if (item.area) {
        dateCounts.areas[item.area_title] = (dateCounts.areas[item.area_title] || 0) + 1
      } else {
        dateCounts.unassigned += 1
      }
      dateCounts.total += 1
      if (item.stop_date && date === end) dateCounts.completions += 1
      counts[date] = dateCounts
    }
  }

  const rows: CountRow[] = Object.entries(counts).map(([date, value]) => ({
    date,
    ...value,
  }))

  return rows.toSorted((a, b) => a.date.localeCompare(b.date))
}
