#!/usr/bin/env -S deno run --allow-read --allow-env --allow-write --allow-ffi --allow-net

import { Database } from '@db/sqlite'
import { expandGlob } from '@std/fs/expand-glob'

// Find Things database path
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

// Date conversions
function thingsDateToIso(td: number | null): string | null {
  if (!td) return null
  const year = (td >> 16) & 0x7ff
  const month = (td >> 12) & 0xf
  const day = (td >> 7) & 0x1f
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function unixToDatetime(ts: number | null): string | null {
  if (!ts) return null
  // Things stores unix timestamps (seconds since 1970-01-01)
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${
    pad(d.getHours())
  }:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

  // Only include area/project/heading if present
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
  result.index = row.idx
  result.today_index = row.todayIndex ?? 0

  return result
}

function transformArea(row: Row): Record<string, unknown> {
  return {
    uuid: row.uuid,
    type: 'area',
    title: row.title,
  }
}

function transformChecklistItem(row: Row): Record<string, unknown> {
  return {
    type: 'checklist-item',
    uuid: row.uuid,
    title: row.title,
    status: STATUS_MAP[row.status as number] ?? row.status,
    created: unixToDatetime(row.creationDate as number | null),
    modified: unixToDatetime(row.userModificationDate as number | null),
    stop_date: unixToDatetime(row.stopDate as number | null),
  }
}

class Things {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true })
  }

  close() {
    this.db.close()
  }

  areas(): Row[] {
    return this.db
      .prepare(`SELECT uuid, title FROM TMArea ORDER BY "index"`)
      .all()
      .map(transformArea)
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
      .map(transformTask)
  }

  todos(options: { status?: string } = {}): Row[] {
    const statusVal = options.status === 'completed'
      ? 3
      : options.status === 'canceled'
      ? 2
      : 0

    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = ?
          AND t.rt1_recurrenceRule IS NULL
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t."index"`,
      )
      .all(statusVal)
      .map(transformTask)
  }

  // Views filter by start value and startDate
  today(): Row[] {
    const todayIso = localDateStr()
    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0
          AND t.rt1_recurrenceRule IS NULL
          AND t.start = 1 AND t.startDate IS NOT NULL
          AND t.startDate <= ?
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t.todayIndex`,
      )
      .all(isoToThingsDate(todayIso))
      .map(transformTask)
  }

  inbox(): Row[] {
    return this.queryByStart(0)
  }

  anytime(): Row[] {
    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0
          AND t.rt1_recurrenceRule IS NULL
          AND t.start = 1
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t."index"`,
      )
      .all()
      .map(transformTask)
  }

  upcoming(): Row[] {
    // upcoming = Someday items with future start dates
    const todayIso = localDateStr()
    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0
          AND t.rt1_recurrenceRule IS NULL
          AND t.start = 2
          AND t.startDate > ?
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t."index"`,
      )
      .all(isoToThingsDate(todayIso))
      .map(transformTask)
  }

  someday(): Row[] {
    // someday = Someday items without a start date
    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0 AND t.start = 2
          AND t.rt1_recurrenceRule IS NULL
          AND (t.startDate IS NULL OR t.startDate = 0)
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t."index"`,
      )
      .all()
      .map(transformTask)
  }

  private queryByStart(startVal: number): Row[] {
    return this.db
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
        LEFT JOIN TMTask hp ON h.project = hp.uuid
        WHERE t.type = 0 AND t.trashed = 0 AND t.status = 0 AND t.start = ?
          AND t.rt1_recurrenceRule IS NULL
          AND (t.project IS NULL OR p.trashed = 0)
          AND (t.heading IS NULL OR h.trashed = 0)
          AND (h.project IS NULL OR hp.trashed = 0)
        ORDER BY t."index"`,
      )
      .all(startVal)
      .map(transformTask)
  }

  attachChecklistItems(tasks: Row[]): Row[] {
    const uuids = tasks.map((t) => t.uuid as string)
    if (uuids.length === 0) return tasks

    // Batch query all checklist items for these tasks
    const placeholders = uuids.map(() => '?').join(',')
    const items = this.db
      .prepare(
        `SELECT task, uuid, title, status, creationDate, userModificationDate, stopDate
        FROM TMChecklistItem
        WHERE task IN (${placeholders})
        ORDER BY task, "index"`,
      )
      .all(...uuids)
      .map((row) => ({ task: (row as Row).task, ...transformChecklistItem(row as Row) }))

    // Group by task UUID
    const byTask = new Map<string, Row[]>()
    for (const item of items) {
      const taskUuid = item.task as string
      if (!byTask.has(taskUuid)) byTask.set(taskUuid, [])
      byTask.get(taskUuid)!.push(item)
    }

    for (const task of tasks) {
      const taskItems = byTask.get(task.uuid as string)
      task.checklist = taskItems && taskItems.length > 0 ? taskItems : null
    }
    return tasks
  }

  get(uuid: string): Row | null {
    // Try task first
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

    // Try area
    const area = this.db.prepare(`SELECT uuid, title FROM TMArea WHERE uuid = ?`).get(uuid)
    if (area) return transformArea(area as Row)

    return null
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

async function main() {
  const args = Deno.args
  if (args.length < 1) {
    console.error('Usage: things_query.ts <command> [args]')
    console.error(
      'Commands: todos, areas, projects, today, inbox, anytime, upcoming, someday, get',
    )
    Deno.exit(1)
  }

  const cmd = args[0]
  const dbPath = await findDatabasePath()
  const things = new Things(dbPath)

  try {
    let result: unknown

    switch (cmd) {
      case 'todos': {
        const includeChecklists = args.includes('--checklists')
        const incompleteOnly = args.includes('--incomplete')
        let items = things.todos({ status: 'incomplete' })
        if (!incompleteOnly) {
          items = [
            ...items,
            ...things.todos({ status: 'completed' }),
            ...things.todos({ status: 'canceled' }),
          ]
        }
        if (includeChecklists) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'areas':
        result = things.areas()
        break
      case 'projects':
        result = things.projects()
        break
      case 'today': {
        const items = things.today()
        if (args.includes('--checklists')) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'inbox': {
        const items = things.inbox()
        if (args.includes('--checklists')) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'anytime': {
        const items = things.anytime()
        if (args.includes('--checklists')) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'upcoming': {
        const items = things.upcoming()
        if (args.includes('--checklists')) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'someday': {
        const items = things.someday()
        if (args.includes('--checklists')) things.attachChecklistItems(items)
        result = resolveAreas(items, things)
        break
      }
      case 'get':
        if (args.length < 2) {
          console.error('Usage: things_query.ts get <uuid>')
          Deno.exit(1)
        }
        result = things.get(args[1])
        break
      default:
        console.error(`Unknown command: ${cmd}`)
        Deno.exit(1)
    }

    console.log(JSON.stringify(result))
  } finally {
    things.close()
  }
}

main()
