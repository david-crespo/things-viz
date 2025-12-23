import * as path from '@std/path'
import $ from 'dax'
import dayjs from 'dayjs'
import memoize from 'memoize'
import { z } from 'zod'

import { dateToStr, sortBy } from './util.ts'

const scriptPath = path.join(
  path.dirname(path.fromFileUrl(import.meta.url)),
  'things_query.ts',
)

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

// get can return any item type
const anyItemSchema = z.union([todoSchema, projectSchema, areaSchema])

export const NO_AREA = 'No area'

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  return new Date(s.replace(' ', 'T'))
}

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

export async function getAllItems(opts: { incompleteOnly?: boolean } = {}) {
  const args = ['todos', '--checklists']
  if (opts.incompleteOnly) args.push('--incomplete')
  const items = z.array(todoSchema).parse(await $`${scriptPath} ${args}`.json())
  return items.map(parseTodo)
}

export async function getItemByUuid(uuid: string) {
  const result = await $`${scriptPath} get ${uuid}`.json()
  if (!result) return null
  return anyItemSchema.parse(result)
}

export async function getAreas() {
  const areas = z.array(areaSchema).parse(await $`${scriptPath} areas`.json())
  return areas.map((a) => a.title).sort()
}

export async function getProjects() {
  const projects = z.array(projectSchema).parse(
    await $`${scriptPath} projects`.json(),
  )
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
  const items = z
    .array(todoSchema)
    .parse(await $`${scriptPath} ${view} --checklists`.json())
  return items.map(parseTodo)
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
