import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'

type RawGroup = {
  title: string
  items: RawItem[]
}

type ItemBase = {
  uuid: string
  type: 'to-do' | 'project' | 'heading'
  title: string
  status: 'incomplete' | 'completed'
  area?: string
  area_title?: string
  project?: string
  project_title?: string
}

type RawItem = ItemBase & {
  created: string
  stop_date: string | null
}

export type Item = ItemBase & {
  created: Date
  stop_date: Date | null
}

function parseDates(i: RawItem): Item {
  return {
    ...i,
    created: new Date(i.created),
    stop_date: i.stop_date ? new Date(i.stop_date) : null,
  }
}

export async function getAllItems(): Promise<{ todos: Item[]; projects: Item[] }> {
  const items = ((await $`things-cli -j all`.json()) as RawGroup[])
    // No Area is projects, Areas is areas, Today is redundant -- items appear elsewhere
    .filter((i) => ['Upcoming', 'Anytime', 'Someday', 'Logbook'].includes(i.title))
    .flatMap((x) => x.items)
    .map(parseDates)
  return {
    todos: items.filter((i) => i.type === 'to-do'),
    projects: items.filter((i) => i.type === 'project'),
  }
}
