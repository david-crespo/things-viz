import { Database } from '@db/sqlite'
import { expandGlob } from '@std/fs/expand-glob'
import dayjs from 'dayjs'
import memoize from 'memoize'
import { z } from 'zod'

import { dateToStr, sortBy } from './util.ts'

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
  // scheduling bucket: "Inbox", "Anytime", "Someday", or "Upcoming"
  start: z.string(),
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

const anyItemSchema = z.union([todoSchema, projectSchema, areaSchema])

// Database path discovery
async function findDatabasePath(): Promise<string> {
  const envPath = Deno.env.get('THINGSDB')
  if (envPath) return envPath

  const pattern =
    '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite'
  const expanded = pattern.replace('~', Deno.env.get('HOME') || '')

  for await (const entry of expandGlob(expanded)) {
    return entry.path
  }
  throw new Error('Things database not found')
}

// Date conversions - output string format for zod validation
function thingsDateToIso(td: number | null): string | null {
  if (!td) return null
  const year = (td >> 16) & 0x7ff
  const month = (td >> 12) & 0xf
  const day = (td >> 7) & 0x1f
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function unixToDatetime(ts: number | null): string | null {
  if (!ts) return null
  const d = new Date(Math.floor(ts) * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${
    pad(d.getHours())
  }:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function unixToDate(ts: number | null): string | null {
  if (!ts) return null
  const d = new Date(Math.floor(ts) * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Convert string date to Date object
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  return new Date(s.replace(' ', 'T'))
}

const STATUS_MAP: Record<number, string> = {
  0: 'incomplete',
  2: 'canceled',
  3: 'completed',
}
const START_MAP: Record<number, string> = { 0: 'Inbox', 1: 'Anytime', 2: 'Someday' }

type Row = Record<string, unknown>

function transformTask(row: Row): Record<string, unknown> {
  const result: Record<string, unknown> = {
    uuid: row.uuid,
    type: row.type === 1 ? 'project' : 'to-do',
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

function transformChecklistItem(row: Row): Record<string, unknown> {
  return {
    type: 'checklist-item',
    uuid: row.uuid,
    title: row.title,
    status: STATUS_MAP[row.status as number] ?? row.status,
    created: unixToDatetime(row.userModificationDate as number | null),
    modified: unixToDatetime(row.userModificationDate as number | null),
    stop_date: unixToDate(row.stopDate as number | null),
  }
}

function isoToThingsDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (y << 16) | (m << 12) | (d << 7)
}

function localDateStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Convert validated zod todo to final typed format
function parseTodo(item: z.infer<typeof todoSchema>) {
  return {
    ...item,
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
  t.project, p.title as project_title,
  t.heading, h.title as heading_title,
  t.notes, t.start, t.startDate, t.deadline, t.stopDate,
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
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true })
  }

  close() {
    this.db.close()
  }

  [Symbol.dispose]() {
    this.close()
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
        WHERE t.type = 1 AND t.trashed = 0 AND t.status = 0
        ORDER BY t."index"`,
      )
      .all()
      .map((row) => transformTask(row as Row))
  }

  todos(options: { status?: string } = {}): Row[] {
    const statusVal = options.status === 'completed'
      ? 3
      : options.status === 'canceled'
      ? 2
      : 0

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
    return this.db
      .prepare(
        `SELECT ${TODO_COLS} ${TODO_FROM}
        WHERE ${TODO_BASE_WHERE}
          AND t.status = 0 AND t.start = 1
          AND t.startDate IS NOT NULL AND t.startDate <= ?
        ORDER BY t.todayIndex`,
      )
      .all(isoToThingsDate(localDateStr()))
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
          t.project, p.title as project_title,
          t.heading, h.title as heading_title,
          t.notes, t.start, t.startDate, t.deadline, t.stopDate,
          t.creationDate, t.userModificationDate, t."index" as idx, t.todayIndex
        FROM TMTask t
        LEFT JOIN TMArea a ON t.area = a.uuid
        LEFT JOIN TMTask p ON t.project = p.uuid
        LEFT JOIN TMTask h ON t.heading = h.uuid
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

  const projects = new Map(things.projects().map((p) => [p.uuid, p.area_title]))
  for (const item of needsLookup) {
    item.area_title = projects.get(item.project as string) ?? null
  }
  return items
}

// Public API

async function openThings() {
  const dbPath = await findDatabasePath()
  return new Things(dbPath)
}

export async function getAllItems(opts: { incompleteOnly?: boolean } = {}) {
  using things = await openThings()
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

export async function getItemByUuid(uuid: string) {
  using things = await openThings()
  const result = things.get(uuid)
  if (!result) return null
  return anyItemSchema.parse(result)
}

export async function getAreas() {
  using things = await openThings()
  const areas = z.array(areaSchema).parse(things.areas())
  return areas.map((a) => a.title).sort()
}

export async function getProjects() {
  using things = await openThings()
  const projects = z.array(projectSchema).parse(things.projects())
  return projects.map((p) => ({
    uuid: p.uuid,
    title: p.title,
    status: p.status,
    area_title: p.area_title ?? NO_AREA,
    start: p.start,
    start_date: parseDate(p.start_date),
    deadline: parseDate(p.deadline),
    created: parseDate(p.created)!,
  }))
}

export type ViewName = 'today' | 'inbox' | 'anytime' | 'upcoming' | 'someday'
export type Todo = Awaited<ReturnType<typeof getAllItems>>[number]

export async function getViewItems(view: ViewName) {
  using things = await openThings()
  const items = things[view]()
  things.attachChecklistItems(items)
  const resolved = resolveAreas(items, things)
  const parsed = z.array(todoSchema).parse(resolved)
  return parsed.map(parseTodo)
}

const TOTAL = 'Total'
const COMP = 'Completions'

export async function getCounts() {
  const todos = await getAllItems()

  const incrDay = memoize((d: string) => dayjs(d).add(1, 'days').format('YYYY-MM-DD'))

  const tomorrow = incrDay(dateToStr(new Date()))

  type DateKey = string
  type DateCounts = Record<string, number>
  const counts: Record<DateKey, DateCounts> = {}

  const initCounts = (): DateCounts => ({ [TOTAL]: 0, [NO_AREA]: 0, [COMP]: 0 })

  for (const item of todos) {
    const start = dateToStr(item.created)
    const end = item.stop_date ? dateToStr(item.stop_date) : tomorrow

    for (let date = start; date <= end; date = incrDay(date)) {
      const dateCounts = counts[date] || initCounts()
      dateCounts[item.area_title] = (dateCounts[item.area_title] || 0) + 1
      dateCounts[TOTAL] += 1
      if (date === end && date !== tomorrow) dateCounts[COMP] += 1
      counts[date] = dateCounts
    }
  }

  const rows: { date: string; [s: string]: string | number }[] = Object.entries(counts).map(
    (
      [date, value],
    ) => ({ date, ...value }),
  )

  return sortBy(rows, (c) => c.date)
}
