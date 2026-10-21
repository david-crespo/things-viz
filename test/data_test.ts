import { deepStrictEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'

import {
  countsToPlotData,
  getAllItems,
  getAreas,
  getCounts,
  getItemByUuid,
  getProjects,
  getTodoByUuid,
  getViewItems,
  NO_AREA,
} from '../data.ts'
import { thingsDate, ThingsFixture, unixSeconds } from './fixture.ts'

test('getAllItems filters by status and excludes internal rows', async () => {
  using fixture = new ThingsFixture()

  fixture.addTask({ title: 'Incomplete' })
  fixture.addTask({
    title: 'Completed',
    status: 3,
    stopDate: unixSeconds('2026-01-03T12:00:00Z'),
  })
  fixture.addTask({
    title: 'Canceled',
    status: 2,
    stopDate: unixSeconds('2026-01-04T12:00:00Z'),
  })
  fixture.addTask({ title: 'Trashed', trashed: true })
  fixture.addTask({ title: 'Recurring template', recurrenceRule: new Uint8Array([1]) })

  const incomplete = await getAllItems({
    dbPath: fixture.path,
    incompleteOnly: true,
  })
  deepStrictEqual(
    incomplete.map((item) => item.title),
    ['Incomplete'],
  )

  const all = await getAllItems({ dbPath: fixture.path })
  deepStrictEqual(
    all.map((item) => item.title),
    ['Incomplete', 'Completed', 'Canceled'],
  )
})

test('getAllItems resolves heading hierarchy and checklist items', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Launch', area })
  const heading = fixture.addTask({ type: 2, title: 'Follow-up', project })
  const todo = fixture.addTask({
    title: 'Write summary',
    heading,
    notes: 'Include decisions',
  })
  fixture.addChecklistItem({ task: todo, title: 'Draft', index: 2 })
  fixture.addChecklistItem({
    task: todo,
    title: 'Review',
    status: 3,
    stopDate: unixSeconds('2026-01-02T12:00:00Z'),
    index: 1,
  })

  const items = await getAllItems({
    dbPath: fixture.path,
    incompleteOnly: true,
  })
  equal(items.length, 1)
  const item = items[0]
  equal(item.area_title, 'Work')
  equal(item.project, project)
  equal(item.project_title, 'Launch')
  equal(item.heading, heading)
  equal(item.heading_title, 'Follow-up')
  equal(item.notes, 'Include decisions')
  deepStrictEqual(
    item.checklist?.map(({ title, status }) => ({ title, status })),
    [
      { title: 'Review', status: 'completed' },
      { title: 'Draft', status: 'incomplete' },
    ],
  )
})

test('view queries select and order representative tasks', async () => {
  using fixture = new ThingsFixture()

  const arrived = thingsDate(2000, 1, 1)
  const future = thingsDate(2099, 1, 1)

  fixture.addTask({ title: 'Inbox', start: 0 })
  fixture.addTask({ title: 'Today second', start: 1, startDate: arrived, todayIndex: 2 })
  fixture.addTask({ title: 'Today first', start: 2, startDate: arrived, todayIndex: 1 })
  fixture.addTask({ title: 'Upcoming', start: 2, startDate: future })
  fixture.addTask({ title: 'Someday', start: 2 })
  fixture.addTask({ title: 'Completed inbox', status: 3, start: 0 })

  const options = { dbPath: fixture.path }
  deepStrictEqual(
    (await getViewItems('inbox', options)).map((item) => item.title),
    ['Inbox'],
  )
  deepStrictEqual(
    (await getViewItems('today', options)).map((item) => item.title),
    ['Today first', 'Today second'],
  )
  deepStrictEqual(
    (await getViewItems('upcoming', options)).map((item) => item.title),
    ['Upcoming'],
  )
  deepStrictEqual(
    (await getViewItems('someday', options)).map((item) => item.title),
    ['Someday'],
  )
})

test('today includes undated to-dos whose deadline has arrived', async () => {
  using fixture = new ThingsFixture()

  const today = Temporal.Now.plainDateISO()
  const past = thingsDate(2000, 1, 1)
  const future = thingsDate(2099, 1, 1)

  fixture.addTask({ title: 'Scheduled', startDate: past, todayIndex: 2 })
  fixture.addTask({ title: 'Overdue', deadline: past, todayIndex: 3 })
  fixture.addTask({
    title: 'Due today',
    start: 0,
    deadline: thingsDate(today.year, today.month, today.day),
    todayIndex: 1,
  })
  fixture.addTask({ title: 'Suppressed', deadline: past, deadlineSuppressionDate: past })
  fixture.addTask({ title: 'Due later', deadline: future })
  fixture.addTask({ title: 'Done overdue', status: 3, deadline: past })

  deepStrictEqual(
    (await getViewItems('today', { dbPath: fixture.path })).map((item) => item.title),
    ['Due today', 'Scheduled', 'Overdue'],
  )
})

test('headings get their own item type and are not to-dos', async () => {
  using fixture = new ThingsFixture()

  const project = fixture.addTask({ type: 1, title: 'Launch' })
  const heading = fixture.addTask({ type: 2, title: 'Follow-up', project })
  const options = { dbPath: fixture.path }

  deepStrictEqual(await getItemByUuid(heading, options), {
    type: 'heading',
    uuid: heading,
    title: 'Follow-up',
    project,
    project_title: 'Launch',
  })
  equal(await getTodoByUuid(heading, options), null)
  deepStrictEqual(await getAllItems(options), [])
})

test('getAreas and getProjects transform and filter rows', async () => {
  using fixture = new ThingsFixture()

  const work = fixture.addArea({ title: 'Work', index: 2 })
  fixture.addArea({ title: 'Home', index: 1 })
  fixture.addTask({
    type: 1,
    title: 'Active project',
    area: work,
    start: 2,
    startDate: thingsDate(2026, 2, 3),
    deadline: thingsDate(2026, 2, 10),
    creationDate: unixSeconds('2026-01-15T12:00:00Z'),
  })
  fixture.addTask({ type: 1, title: 'Completed project', status: 3 })
  fixture.addTask({ type: 1, title: 'Canceled project', status: 2 })
  fixture.addTask({ type: 1, title: 'Trashed project', trashed: true })

  const options = { dbPath: fixture.path }
  deepStrictEqual(await getAreas(options), ['Home', 'Work'])

  const projects = await getProjects(options)
  deepStrictEqual(
    projects.map(({ title, status, area_title }) => ({ title, status, area_title })),
    [
      { title: 'Active project', status: 'incomplete', area_title: 'Work' },
      { title: 'Completed project', status: 'completed', area_title: NO_AREA },
      { title: 'Canceled project', status: 'canceled', area_title: NO_AREA },
    ],
  )
  equal(projects[0].start, 'Someday')
  equal(projects[0].start_date?.toISOString().slice(0, 10), '2026-02-03')
  equal(projects[0].deadline?.toISOString().slice(0, 10), '2026-02-10')
  equal(projects[0].created?.toISOString(), '2026-01-15T12:00:00.000Z')
})

test('getAllItems resolves direct projects and excludes invalid parents', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Active project', area })
  fixture.addTask({ title: 'Direct child', project })

  const trashedProject = fixture.addTask({
    type: 1,
    title: 'Trashed project',
    trashed: true,
  })
  fixture.addTask({ title: 'Child of trashed project', project: trashedProject })

  const trashedHeading = fixture.addTask({
    type: 2,
    title: 'Trashed heading',
    project,
    trashed: true,
  })
  fixture.addTask({ title: 'Child of trashed heading', heading: trashedHeading })

  const headingInTrashedProject = fixture.addTask({
    type: 2,
    title: 'Heading in trashed project',
    project: trashedProject,
  })
  fixture.addTask({
    title: 'Heading child of trashed project',
    heading: headingInTrashedProject,
  })

  const items = await getAllItems({ dbPath: fixture.path, incompleteOnly: true })
  equal(items.length, 1)
  equal(items[0].title, 'Direct child')
  equal(items[0].project, project)
  equal(items[0].project_title, 'Active project')
  equal(items[0].area_title, 'Work')
})

test('getAllItems transforms dates and scheduling state', async () => {
  using fixture = new ThingsFixture()

  fixture.addTask({
    title: 'Scheduled task',
    start: 1,
    startBucket: 1,
    startDate: thingsDate(2026, 3, 4),
    deadline: thingsDate(2026, 3, 9),
    creationDate: unixSeconds('2026-03-01T01:02:03Z'),
    modificationDate: unixSeconds('2026-03-02T04:05:06Z'),
  })

  const [item] = await getAllItems({
    dbPath: fixture.path,
    incompleteOnly: true,
  })
  equal(item.start, 'Anytime')
  equal(item.evening, true)
  equal(item.start_date?.toISOString(), '2026-03-04T00:00:00.000Z')
  equal(item.deadline?.toISOString(), '2026-03-09T00:00:00.000Z')
  equal(item.created.toISOString(), '2026-03-01T01:02:03.000Z')
  equal(item.modified?.toISOString(), '2026-03-02T04:05:06.000Z')
})

test('item lookup handles to-dos, projects, areas, and missing IDs', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Project', area })
  const todo = fixture.addTask({ title: 'Task', project })
  fixture.addChecklistItem({ task: todo, title: 'Step' })

  const options = { dbPath: fixture.path }
  equal((await getItemByUuid(area, options))?.type, 'area')
  equal((await getItemByUuid(project, options))?.type, 'project')
  equal((await getItemByUuid(todo, options))?.type, 'to-do')
  equal(await getItemByUuid('missing', options), null)
  equal(await getTodoByUuid(project, options), null)

  const result = await getTodoByUuid(todo, options)
  equal(result?.project_title, 'Project')
  equal(result?.area_title, 'Work')
  deepStrictEqual(
    result?.checklist?.map((item) => item.title),
    ['Step'],
  )
})

test('anytime excludes completed, trashed, and recurring tasks', async () => {
  using fixture = new ThingsFixture()

  fixture.addTask({ title: 'Ready', start: 1 })
  fixture.addTask({ title: 'Inbox', start: 0 })
  fixture.addTask({ title: 'Completed', start: 1, status: 3 })
  fixture.addTask({ title: 'Trashed', start: 1, trashed: true })
  fixture.addTask({
    title: 'Recurring template',
    start: 1,
    recurrenceRule: new Uint8Array([1]),
  })

  const items = await getViewItems('anytime', { dbPath: fixture.path })
  deepStrictEqual(
    items.map((item) => item.title),
    ['Ready'],
  )
})

test('getCounts reconstructs historical area totals and stop events', async () => {
  using fixture = new ThingsFixture()

  const work = fixture.addArea({ title: 'Work' })
  fixture.addTask({
    title: 'Completed work task',
    status: 3,
    area: work,
    creationDate: unixSeconds('2026-01-01T12:00:00Z'),
    stopDate: unixSeconds('2026-01-03T12:00:00Z'),
  })
  fixture.addTask({
    title: 'Canceled unassigned task',
    status: 2,
    creationDate: unixSeconds('2026-01-02T12:00:00Z'),
    stopDate: unixSeconds('2026-01-02T18:00:00Z'),
  })

  deepStrictEqual(await getCounts({ dbPath: fixture.path }), [
    {
      date: '2026-01-01',
      total: 1,
      completions: 0,
      unassigned: 0,
      areas: { Work: 1 },
    },
    {
      date: '2026-01-02',
      total: 2,
      completions: 1,
      unassigned: 1,
      areas: { Work: 1 },
    },
    {
      date: '2026-01-03',
      total: 1,
      completions: 1,
      unassigned: 0,
      areas: { Work: 1 },
    },
  ])
})

test('getCounts buckets timestamps by local calendar day', async () => {
  using fixture = new ThingsFixture()

  fixture.addTask({
    title: 'Chicago evening',
    status: 3,
    creationDate: unixSeconds('2026-01-19T00:30:00Z'),
    stopDate: unixSeconds('2026-01-19T00:30:00Z'),
  })
  fixture.addTask({
    title: 'Chicago after midnight',
    status: 3,
    creationDate: unixSeconds('2026-01-19T06:30:00Z'),
    stopDate: unixSeconds('2026-01-19T06:30:00Z'),
  })

  deepStrictEqual(await getCounts({ dbPath: fixture.path, timeZone: 'America/Chicago' }), [
    {
      date: '2026-01-18',
      total: 1,
      completions: 1,
      unassigned: 1,
      areas: {},
    },
    {
      date: '2026-01-19',
      total: 1,
      completions: 1,
      unassigned: 1,
      areas: {},
    },
  ])
})

test('getCounts keeps reserved area names separate from synthetic series', async () => {
  using fixture = new ThingsFixture()

  const totalArea = fixture.addArea({ title: 'Total' })
  const completionsArea = fixture.addArea({ title: 'Completions' })
  const noAreaArea = fixture.addArea({ title: NO_AREA })
  const noAreaProject = fixture.addTask({ type: 1, title: 'Project', area: noAreaArea })
  const placements = [
    { area: totalArea },
    { area: completionsArea },
    { project: noAreaProject },
    {},
  ]
  for (const [index, placement] of placements.entries()) {
    fixture.addTask({
      title: `Task ${index}`,
      status: 3,
      ...placement,
      creationDate: unixSeconds('2026-01-05T12:00:00Z'),
      stopDate: unixSeconds('2026-01-05T13:00:00Z'),
    })
  }

  const counts = await getCounts({ dbPath: fixture.path })
  deepStrictEqual(counts, [
    {
      date: '2026-01-05',
      total: 4,
      completions: 4,
      unassigned: 1,
      areas: { Total: 1, Completions: 1, [NO_AREA]: 1 },
    },
  ])
  deepStrictEqual(
    countsToPlotData(counts).map(({ kind, area, label, count }) => ({
      kind,
      area,
      label,
      count,
    })),
    [
      { kind: 'total', area: 'total', label: 'Total', count: 4 },
      { kind: 'completions', area: 'completions', label: 'Completions', count: 4 },
      { kind: 'unassigned', area: 'unassigned', label: NO_AREA, count: 1 },
      { kind: 'area', area: 'area:Completions', label: 'Completions', count: 1 },
      { kind: 'area', area: `area:${NO_AREA}`, label: NO_AREA, count: 1 },
      { kind: 'area', area: 'area:Total', label: 'Total', count: 1 },
    ],
  )
})

test('getCounts returns no rows for an empty database', async () => {
  using fixture = new ThingsFixture()

  deepStrictEqual(await getCounts({ dbPath: fixture.path }), [])
})
