import dayjs from 'npm:dayjs@1.11.10'
import memoize from 'npm:memoize'

import { dateToStr, sortBy } from './util.ts'
import { getAllItems } from './data.ts'

export async function getCounts() {
  const items = await getAllItems()

  // TODO: see if we're missing items under headings

  const projectAreas = Object.fromEntries(
    items
      .filter((i) => i.type === 'project')
      .map((
        p,
      ) => [p.uuid, { project_title: p.title, area_title: p.area_title }]),
  )

  // memoizing here cuts the whole script down from over 1s to like 100ms
  const incrDay = memoize((d: string) => dayjs(d).add(1, 'days').format('YYYY-MM-DD'))

  const tomorrow = incrDay(dateToStr(new Date()))

  type DateKey = string
  type DateCounts = Record<string, number>
  const counts: Record<DateKey, DateCounts> = {}

  const NO_AREA = 'No area'
  const TOTAL = 'Total'
  const COMP = 'Completions'
  const initCounts = (): DateCounts => ({ [TOTAL]: 0, [NO_AREA]: 0, [COMP]: 0 })

  // Create a dataset of days and counts. To start, all I care about is how
  // many items are open on a given day, i.e., is that date between created and
  // stop_date, inclusive. If an item is completed on a given day, we should
  // consider it open on that day and closed on the next
  for (const item of items) {
    const start = dateToStr(item.created)
    // if it is incomplete it is open for all days up to today. but
    // actually go up to tomorrow to see items completed today
    const end = item.stop_date ? dateToStr(item.stop_date) : tomorrow

    const projectArea = item.project ? projectAreas[item.project]?.area_title : undefined
    const area = item.area_title || projectArea || NO_AREA

    // for each date in the range for this item, increment the counts
    for (let date = start; date <= end; date = incrDay(date)) {
      const dateCounts = counts[date] || initCounts()
      dateCounts[area] = (dateCounts[area] || 0) + 1
      dateCounts[TOTAL] += 1
      if (date === end && date !== tomorrow) dateCounts[COMP] += 1
      counts[date] = dateCounts
    }
  }

  return sortBy(
    Object.entries(counts).map(([date, value]) => ({ date, ...value })),
    (c) => c.date,
  )
}
