import { deepStrictEqual, equal } from 'node:assert/strict'

import { runTestCli } from './cli.ts'
import { thingsDate, ThingsFixture, unixSeconds } from './fixture.ts'

Deno.test('areas covers its distinct output branches', async () => {
  using fixture = new ThingsFixture()
  fixture.addArea({ title: 'Work' })
  fixture.addArea({ title: 'Home' })

  const json = await runTestCli(fixture, ['areas', '--format', 'json'])
  deepStrictEqual(JSON.parse(json.stdout), ['Home', 'Work'])

  const pretty = await runTestCli(fixture, ['areas'])
  equal(pretty.stdout, 'Home\nWork\n')
})

Deno.test('projects covers status, area, dates, and distinct output branches', async () => {
  using fixture = new ThingsFixture()
  const workId = fixture.addArea({ title: 'Work' })
  const homeId = fixture.addArea({ title: 'Home' })
  const launchId = fixture.addTask({
    type: 1,
    title: 'Launch',
    area: workId,
    startDate: thingsDate(2026, 8, 1),
    deadline: thingsDate(2026, 8, 2),
    creationDate: unixSeconds('2026-01-02T12:00:00Z'),
  })
  const backlogId = fixture.addTask({ type: 1, title: 'Backlog' })
  const shippedId = fixture.addTask({
    type: 1,
    title: 'Shipped',
    status: 3,
    area: homeId,
    creationDate: unixSeconds('2026-01-03T12:00:00Z'),
  })

  const defaults = await runTestCli(fixture, ['projects', '--format', 'json'])
  deepStrictEqual(JSON.parse(defaults.stdout), [
    {
      uuid: backlogId,
      area: 'No area',
      project: 'Backlog',
      start: 'Anytime',
      start_date: null,
      deadline: null,
      created: '2026-01-01T12:00:02.000Z',
    },
    {
      uuid: launchId,
      area: 'Work',
      project: 'Launch',
      start: 'Anytime',
      start_date: '2026-08-01',
      deadline: '2026-08-02',
      created: '2026-01-02T12:00:00.000Z',
    },
  ])

  const completed = await runTestCli(fixture, [
    'projects',
    '--completed',
    '--format',
    'tsv',
  ])
  equal(
    completed.stdout,
    'uuid\tarea\tproject\twhen\tstart_date\tdeadline\tcreated\n' +
      `${shippedId}\tHome\tShipped\tAnytime\t\t\t2026-01-03\n`,
  )

  const filtered = await runTestCli(fixture, [
    'projects',
    '--all',
    '--area',
    'work',
    '--format',
    'short',
  ])
  equal(filtered.stdout, '[Work] Launch (scheduled: 2026-08-01 | deadline: 2026-08-02)\n')
})

Deno.test('todos covers project, deadline, and recent filters', async () => {
  using fixture = new ThingsFixture()
  const work = fixture.addArea({ title: 'Work' })
  const launch = fixture.addTask({ type: 1, title: 'Launch', area: work })
  const daysAgo = (days: number) => Date.now() / 1000 - days * 24 * 60 * 60
  fixture.addTask({
    title: 'Fresh deadline',
    project: launch,
    deadline: thingsDate(2026, 8, 1),
    modificationDate: daysAgo(2),
  })
  fixture.addTask({
    title: 'Old deadline',
    project: launch,
    deadline: thingsDate(2026, 8, 1),
    modificationDate: daysAgo(17),
  })
  fixture.addTask({
    title: 'Fresh without deadline',
    project: launch,
    modificationDate: daysAgo(2),
  })

  const result = await runTestCli(fixture, [
    'todos',
    '--project',
    'lau',
    '--deadline',
    '--recent',
    '7',
  ])

  equal(result.stdout, '[Work > Launch] Fresh deadline (deadline: 2026-08-01)\n')
})

Deno.test('logbook covers status, ordering, limits, and JSON shaping', async () => {
  using fixture = new ThingsFixture()
  const work = fixture.addArea({ title: 'Work' })
  fixture.addTask({
    title: 'Completed earlier',
    status: 3,
    area: work,
    stopDate: unixSeconds('2026-01-02T12:00:00Z'),
  })
  fixture.addTask({
    title: 'Canceled later',
    status: 2,
    area: work,
    stopDate: unixSeconds('2026-01-03T12:00:00Z'),
  })
  fixture.addTask({
    title: 'Completed without stop date',
    status: 3,
    area: work,
  })

  const result = await runTestCli(fixture, ['logbook', '--limit', '2', '--format', 'json'])
  deepStrictEqual(
    JSON.parse(result.stdout).map((item: { title: string; status: string }) => ({
      title: item.title,
      status: item.status,
    })),
    [
      { title: 'Canceled later', status: 'canceled' },
      { title: 'Completed earlier', status: 'completed' },
    ],
  )

  const empty = await runTestCli(fixture, ['logbook', '--limit', '0', '--format', 'json'])
  equal(empty.stdout, '[]\n')
})

Deno.test('empty table and missing link have explicit outcomes', async () => {
  using fixture = new ThingsFixture()

  const table = await runTestCli(fixture, ['table'])
  equal(table.code, 0)
  equal(table.stdout, '')

  const link = await runTestCli(fixture, ['link', 'missing'])
  equal(link.code, 1)
  equal(link.stdout, '')
  equal(link.stderr, 'Item not found: missing\n')
})

Deno.test('add todo covers project placement and remaining URL fields', async () => {
  using fixture = new ThingsFixture()

  const result = await runTestCli(
    fixture,
    [
      'add',
      'todo',
      'Ship 🚀',
      '--project',
      'Launch',
      '--heading',
      'Plan',
      '--when',
      'tomorrow',
      '--deadline',
      '2026-08-02',
      '--checklist',
      'First',
      '--checklist',
      'Second',
    ],
    { stdin: 'Notes' },
  )

  deepStrictEqual(Object.fromEntries(new URL(result.launchedUrls[0]).searchParams), {
    title: 'Ship 🚀',
    list: 'Launch',
    heading: 'Plan',
    when: 'tomorrow',
    deadline: '2026-08-02',
    notes: 'Notes',
    'checklist-items': 'First\nSecond',
  })
  equal(result.stderr.includes('auth-token'), false)

  const invalid = await runTestCli(fixture, [
    'add',
    'todo',
    'Invalid',
    '--area',
    'Work',
    '--project',
    'Launch',
  ])
  equal(invalid.code, 2)
  equal(invalid.stderr.includes('--area and --project are mutually exclusive'), true)
  deepStrictEqual(invalid.launchedUrls, [])
})

Deno.test('add project covers the ordinary URL contract', async () => {
  using fixture = new ThingsFixture()

  const result = await runTestCli(
    fixture,
    [
      'add',
      'project',
      'Launch',
      '--area',
      'Work',
      '--when',
      'someday',
      '--deadline',
      '2026-08-02',
    ],
    { stdin: 'Project notes' },
  )

  const url = new URL(result.launchedUrls[0])
  equal(url.pathname, '/add-project')
  deepStrictEqual(Object.fromEntries(url.searchParams), {
    title: 'Launch',
    area: 'Work',
    when: 'someday',
    deadline: '2026-08-02',
    notes: 'Project notes',
  })
})

Deno.test('update covers the remaining URL fields and token failure', async () => {
  using fixture = new ThingsFixture()
  const todo = fixture.addTask({ title: 'Task' })

  const result = await runTestCli(fixture, [
    'update',
    todo,
    '--prepend-notes',
    'Before',
    '--append-notes',
    'After',
    '--when',
    'tomorrow',
    '--heading',
    'Plan',
    '--completed',
    '--add-tags',
    'one,two',
    '--checklist',
    'Replace',
    '--append-checklist',
    'Append',
    '--prepend-checklist',
    'Prepend',
  ])
  deepStrictEqual(Object.fromEntries(new URL(result.launchedUrls[0]).searchParams), {
    id: todo,
    'auth-token': 'test-token',
    'prepend-notes': 'Before',
    'append-notes': 'After',
    when: 'tomorrow',
    heading: 'Plan',
    completed: 'true',
    'add-tags': 'one,two',
    'checklist-items': 'Replace',
    'append-checklist-items': 'Append',
    'prepend-checklist-items': 'Prepend',
  })
  equal(result.stderr.includes('auth-token=***'), true)
  equal(result.stderr.includes('test-token'), false)

  const missingToken = await runTestCli(fixture, ['update', todo, '--canceled'], {
    token: null,
  })
  equal(missingToken.code, 1)
  equal(missingToken.stderr, 'THINGS_TOKEN required. Set it in env or .env file.\n')
  deepStrictEqual(missingToken.launchedUrls, [])
})
