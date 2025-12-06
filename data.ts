import $ from 'dax'
import { z } from 'zod'

const itemShared = z.object({
  uuid: z.string(),
  title: z.string(),
  status: z.enum(['incomplete', 'completed', 'canceled']),
  created: z.string(),
  modified: z.string().nullable(),
  start: z.string(), // "Anytime", "Someday", "Upcoming", etc.
  start_date: z.string().nullable(), // scheduled date
  deadline: z.string().nullable(),
  stop_date: z.string().nullable(),
  notes: z.string().optional(),
})

const todoSchema = z.object({
  type: z.literal('to-do'),
  heading: z.string().optional(),
  heading_title: z.string().optional(),
  project: z.string().optional(),
  project_title: z.string().optional(),
  area: z.string().optional(),
  area_title: z.string().optional(),
})

// projects are usually in areas but don't have to be
const projectSchema = z.object({
  type: z.literal('project'),
  area: z.string().optional(), // a UUID
  area_title: z.string().optional(),
})

// headings are always in projects
const headingSchema = z.object({
  type: z.literal('heading'),
  project: z.string(), // a UUID
  project_title: z.string(),
})

const itemSchema = z.discriminatedUnion('type', [
  todoSchema.merge(itemShared),
  projectSchema.merge(itemShared),
  headingSchema.merge(itemShared),
  // only one that doesn't use the shared thing
  z.object({ type: z.literal('area'), uuid: z.string(), title: z.string() }),
])

/** An array of group objects */
const allItemsSchema = z.array(z.object({
  title: z.string(),
  items: z.array(itemSchema),
}))

export const NO_AREA = 'No area'

export async function getAllItems() {
  const parsedItems = allItemsSchema.parse(await $`things-cli -j all`.json())
    // No Area is projects, Areas is areas, Today is redundant -- items appear elsewhere
    .filter((i) => ['Upcoming', 'Anytime', 'Someday', 'Logbook'].includes(i.title))
    .flatMap((x) => x.items)

  const projectAreas = Object.fromEntries(
    parsedItems
      .filter((i) => i.type === 'project')
      .map((p) => [p.uuid, p.area_title]),
  )

  // headings only exist in projects. to get the area you need to go through the project
  const headingAreas = Object.fromEntries(
    parsedItems
      .filter((i) => i.type === 'heading').map((
        h,
      ) => [h.uuid, projectAreas[h.project]]),
  )

  // parse dates and make sure everything has area_title
  return parsedItems.filter((i) => i.type === 'to-do').map((item) => {
    return {
      ...item,
      created: new Date(item.created),
      modified: item.modified ? new Date(item.modified) : null,
      start_date: item.start_date ? new Date(item.start_date) : null,
      deadline: item.deadline ? new Date(item.deadline) : null,
      stop_date: item.stop_date ? new Date(item.stop_date) : null,
      area_title: item.area_title ||
        (item.project
          ? projectAreas[item.project]!
          : item.heading
          ? headingAreas[item.heading]!
          : NO_AREA),
    }
  })
}
