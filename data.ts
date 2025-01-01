import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'

type RawGroup = {
  title: string
  items: RawItem[]
}

type ItemBase = {
  uuid: string
  type: 'to-do' | 'project' | 'heading'
  title: string
  status: 'incomplete' | 'completed' | 'canceled'
  area?: string
  area_title?: string
  project?: string
  project_title?: string
  heading?: string
  heading_title?: string
}

type RawItem = ItemBase & {
  created: string
  stop_date: string | null
}

export type Item = ItemBase & {
  created: Date
  stop_date: Date | null
  area_title: string
}

export const NO_AREA = 'No area'

export async function getAllItems(): Promise<Item[]> {
  const rawItems = ((await $`things-cli -j all`.json()) as RawGroup[])
    // No Area is projects, Areas is areas, Today is redundant -- items appear elsewhere
    .filter((i) => ['Upcoming', 'Anytime', 'Someday', 'Logbook'].includes(i.title))
    .flatMap((x) => x.items)

  const projects = rawItems.filter((i) => i.type === 'project')
  const projectAreas = Object.fromEntries(
    projects
      .map((p) => [p.uuid, { project_title: p.title, area_title: p.area_title }]),
  )

  // headings only exist in projects. to get the area you need to go through the project
  const headings = rawItems.filter((i) => i.type === 'heading')
  const headingProjects = Object.fromEntries(
    headings
      .map((
        h,
      ) => [h.uuid, {
        heading_title: h.title,
        area_title: projectAreas[h.project!]?.area_title,
      }]),
  )

  // parse dates and make sure everyhing
  return rawItems.filter((i) => i.type === 'to-do').map((item) => {
    const projectArea = item.project
      ? projectAreas[item.project]?.area_title
      : item.heading
      ? headingProjects[item.heading]?.area_title
      : undefined
    return {
      ...item,
      created: new Date(item.created),
      stop_date: item.stop_date ? new Date(item.stop_date) : null,
      area_title: item.area_title || projectArea || NO_AREA,
    }
  })
}
