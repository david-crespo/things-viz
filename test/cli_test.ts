import { deepStrictEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'

import { runTestCli } from './cli.ts'
import { thingsDate, ThingsFixture, unixSeconds } from './fixture.ts'

const todoJsonSchema = z.object({
  uuid: z.string(),
  title: z.string(),
  status: z.enum(['incomplete', 'canceled', 'completed']),
  area: z.string(),
  project: z.string().nullable(),
  heading: z.string().nullable(),
  notes: z.string().nullable(),
  created: z.string(),
  checklist: z.array(z.object({ title: z.string() })).nullable(),
})

test('todos --all --format json runs through the CLI against a fixture', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Launch', area })
  const heading = fixture.addTask({ type: 2, title: 'Follow-up', project })
  const todo = fixture.addTask({
    title: 'Write summary',
    heading,
    notes: 'Include decisions',
    creationDate: unixSeconds('2026-01-02T03:04:05Z'),
  })
  fixture.addChecklistItem({ task: todo, title: 'Draft' })
  fixture.addTask({
    title: 'Already shipped',
    status: 3,
    stopDate: unixSeconds('2026-01-03T04:05:06Z'),
  })

  const result = await runTestCli(fixture, ['todos', '--all', '--format', 'json'])
  const output = z.array(todoJsonSchema).parse(JSON.parse(result.stdout))

  equal(result.code, 0)
  equal(result.stdout.endsWith('\n'), true)
  deepStrictEqual(
    output.map(({ title, status }) => ({ title, status })),
    [
      { title: 'Write summary', status: 'incomplete' },
      { title: 'Already shipped', status: 'completed' },
    ],
  )
  deepStrictEqual(output[0], {
    uuid: todo,
    title: 'Write summary',
    status: 'incomplete',
    area: 'Work',
    project: 'Launch',
    heading: 'Follow-up',
    notes: 'Include decisions',
    created: '2026-01-02T03:04:05.000Z',
    checklist: [{ title: 'Draft' }],
  })
})

test('item --format json preserves evening state from todos', async () => {
  using fixture = new ThingsFixture()

  const evening = fixture.addTask({ title: 'Evening task', startBucket: 1 })
  const daytime = fixture.addTask({ title: 'Daytime task', startBucket: 0 })
  const stateSchema = z.array(z.object({ uuid: z.string(), evening: z.boolean() }))

  const todosResult = await runTestCli(fixture, ['todos', '--format', 'json'])
  const todos = stateSchema.parse(JSON.parse(todosResult.stdout))
  const listedStates = new Map(todos.map((todo) => [todo.uuid, todo.evening]))

  for (const [uuid, expected] of [
    [evening, true],
    [daytime, false],
  ] as const) {
    equal(listedStates.get(uuid), expected)

    const itemResult = await runTestCli(fixture, ['item', uuid, '--format', 'json'])
    deepStrictEqual(stateSchema.parse(JSON.parse(itemResult.stdout)), [
      { uuid, evening: expected },
    ])
  }
})

test('item captures exact area and project output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Launch', area })

  for (const [uuid, expected] of [
    [area, '[Area] Work\n'],
    [project, '[Project] Launch\n'],
  ] as const) {
    const result = await runTestCli(fixture, ['item', uuid])
    equal(result.stdout, expected)
  }
})

test('item shows project notes in pretty and json output', async () => {
  using fixture = new ThingsFixture()

  const areaId = fixture.addArea({ title: 'Work' })
  const projectId = fixture.addTask({
    type: 1,
    title: 'Launch',
    area: areaId,
    notes: 'Why we launch\nhttps://example.com',
    deadline: thingsDate(2026, 8, 2),
    creationDate: unixSeconds('2026-01-02T12:00:00Z'),
  })

  const pretty = await runTestCli(fixture, ['item', projectId, '--format', 'pretty'])
  equal(
    pretty.stdout,
    '[Project] Launch\n' +
      '  area: Work | deadline: 2026-08-02\n' +
      '  Why we launch\n  https://example.com\n',
  )

  const json = await runTestCli(fixture, ['item', projectId, '--format', 'json'])
  deepStrictEqual(JSON.parse(json.stdout), {
    uuid: projectId,
    type: 'project',
    title: 'Launch',
    status: 'incomplete',
    area: 'Work',
    notes: 'Why we launch\nhttps://example.com',
    start: 'Anytime',
    start_date: null,
    deadline: '2026-08-02',
    created: '2026-01-02T12:00:00.000Z',
  })
})

test('todos captures exact TSV output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  fixture.addTask({
    title: 'Write\tsummary\nnow',
    area,
    creationDate: unixSeconds('2026-01-02T18:04:00Z'),
  })

  const localCreated = Temporal.Instant.from('2026-01-02T18:04:00Z')
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
    .replace('T', ' ')
  const result = await runTestCli(fixture, ['todos', '--format', 'tsv'])

  equal(
    result.stdout,
    `uuid\tcreated\tstop_date\tarea\tproject\theading\ttitle\tscheduled\tdeadline\n` +
      `task-1\t${localCreated}\t\tWork\t\t\tWrite summary now\t\t\n`,
  )
})

test('todos captures exact pretty output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const todo = fixture.addTask({
    title: 'Write summary',
    area,
    notes: 'First line\nSecond line',
    creationDate: unixSeconds('2026-01-02T12:00:00Z'),
  })
  fixture.addChecklistItem({ task: todo, title: 'Draft' })

  const result = await runTestCli(fixture, ['todos', '--format', 'pretty'])

  equal(
    result.stdout,
    '[Work] Write summary\n' +
      '  created: 2026-01-02\n' +
      '  First line\n' +
      '  Second line\n' +
      '  ○ Draft\n',
  )
})

test('pretty todos and TSV projects print created dates in local time', async () => {
  using fixture = new ThingsFixture()

  // 19:30 and 20:00 on the previous day in Chicago
  const created = unixSeconds('2026-01-03T01:30:00Z')
  const modified = unixSeconds('2026-01-04T02:00:00Z')
  fixture.addTask({
    title: 'Evening task',
    creationDate: created,
    modificationDate: modified,
  })
  const projectId = fixture.addTask({
    type: 1,
    title: 'Evening project',
    creationDate: created,
  })
  const timeZone = 'America/Chicago'

  const todos = await runTestCli(fixture, ['todos', '--format', 'pretty'], { timeZone })
  equal(
    todos.stdout,
    '[No area] Evening task\n  created: 2026-01-02 | modified: 2026-01-03\n',
  )

  const projects = await runTestCli(fixture, ['projects', '--format', 'tsv'], { timeZone })
  equal(
    projects.stdout.split('\n')[1],
    `${projectId}\tNo area\tEvening project\tAnytime\t\t\t2026-01-02`,
  )
})

test('areas captures exact TSV output', async () => {
  using fixture = new ThingsFixture()

  fixture.addArea({ title: 'Work' })
  fixture.addArea({ title: 'Home\nAdmin' })

  const result = await runTestCli(fixture, ['areas', '--format', 'tsv'])

  equal(result.stdout, 'area\nHome Admin\nWork\n')
})

test('projects captures exact short output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  fixture.addTask({ type: 1, title: 'Launch', area })

  const result = await runTestCli(fixture, ['projects', '--format', 'short'])

  equal(result.stdout, '[Work] Launch\n')
})

test('CLI reports validation and domain failures on stderr', async () => {
  using fixture = new ThingsFixture()

  const invalidFormat = await runTestCli(fixture, ['todos', '--format', 'xml'])
  equal(invalidFormat.code, 1)
  equal(invalidFormat.stdout, '')
  equal(invalidFormat.stderr.includes("argument 'xml' is invalid"), true)

  const invalidLimit = await runTestCli(fixture, ['logbook', '--limit', 'ten'])
  equal(invalidLimit.code, 1)
  equal(invalidLimit.stderr.includes('Not an integer.'), true)

  const missingItem = await runTestCli(fixture, ['item', 'missing'])
  equal(missingItem.code, 1)
  equal(missingItem.stdout, '')
  equal(missingItem.stderr, 'Item not found: missing\n')
})

test('CLI prints help and reports parser failures', async () => {
  using fixture = new ThingsFixture()

  const help = await runTestCli(fixture, ['--help'])
  equal(help.code, 0)
  equal(help.stderr, '')
  equal(help.stdout.includes('Usage:'), true)
  equal(help.stdout.includes('tviz'), true)
  equal(help.stdout.includes('Commands:'), true)

  const todosHelp = await runTestCli(fixture, ['todos', '--help'])
  equal(todosHelp.code, 0)
  equal(todosHelp.stderr, '')
  equal(todosHelp.stdout.includes('Usage:'), true)
  equal(todosHelp.stdout.includes('tviz'), true)
  equal(todosHelp.stdout.includes('todos'), true)

  // Without a subcommand, Commander prints help to stderr
  for (const args of [[], ['add']]) {
    const result = await runTestCli(fixture, args)
    equal(result.code, 1)
    equal(result.stdout, '')
    equal(result.stderr.includes('Usage:'), true)
  }

  const unknown = await runTestCli(fixture, ['unknown'])
  equal(unknown.code, 1)
  equal(unknown.stderr.includes("error: unknown command 'unknown'"), true)
})

test('todos applies representative CLI filters', async () => {
  using fixture = new ThingsFixture()

  const work = fixture.addArea({ title: 'Work' })
  const home = fixture.addArea({ title: 'Home' })
  fixture.addTask({ title: 'Ship report', area: work, notes: 'quarterly' })
  fixture.addTask({ title: 'Buy milk', area: home, notes: 'groceries' })
  fixture.addTask({
    title: 'Old report',
    area: work,
    status: 3,
    stopDate: unixSeconds('2026-01-03T12:00:00Z'),
  })

  const result = await runTestCli(fixture, [
    'todos',
    '--area',
    'work',
    '--search',
    'report',
  ])
  equal(result.stdout, '[Work] Ship report\n')

  const completed = await runTestCli(fixture, ['todos', '--completed'])
  equal(completed.stdout.startsWith('[Work] Old report (done:'), true)
  equal(completed.stdout.includes('Ship report'), false)
})

test('views and logbook run through CLI actions', async () => {
  using fixture = new ThingsFixture()

  const work = fixture.addArea({ title: 'Work' })
  fixture.addTask({ title: 'Inbox task', area: work, start: 0 })
  fixture.addTask({
    title: 'Completed task',
    area: work,
    status: 3,
    stopDate: unixSeconds('2026-01-03T12:00:00Z'),
  })

  const inbox = await runTestCli(fixture, ['inbox'])
  equal(inbox.stdout, '[Work] Inbox task (inbox)\n')

  const logbook = await runTestCli(fixture, ['logbook', '--area', 'work', '--limit', '1'])
  equal(logbook.stdout.startsWith('[Work] Completed task (done:'), true)
})

test('link and add commands return terminal output and URL effects', async () => {
  using fixture = new ThingsFixture()

  const todo = fixture.addTask({ title: 'Task' })
  const link = await runTestCli(fixture, ['link', todo])
  equal(
    link.stdout,
    `\x1b]8;;things:///show?id=${todo}\x1b\\\x1b[34mTask\x1b[0m\x1b]8;;\x1b\\\n`,
  )

  const addTodo = await runTestCli(
    fixture,
    ['add', 'todo', 'New task', '--area', 'Work', '--checklist', 'First'],
    { stdin: 'Notes' },
  )
  deepStrictEqual(Object.fromEntries(new URL(addTodo.launchedUrls[0]).searchParams), {
    title: 'New task',
    list: 'Work',
    notes: 'Notes',
    'checklist-items': 'First',
  })

  const addProject = await runTestCli(fixture, [
    'add',
    'project',
    'Launch',
    '--heading',
    'Plan',
  ])
  const projectUrl = new URL(addProject.launchedUrls[0])
  equal(projectUrl.pathname, '/json')
  deepStrictEqual(JSON.parse(projectUrl.searchParams.get('data') ?? ''), [
    {
      type: 'project',
      attributes: {
        title: 'Launch',
        items: [{ type: 'heading', attributes: { title: 'Plan' } }],
      },
    },
  ])
})

test('update dispatches to the URL command for the item type', async () => {
  using fixture = new ThingsFixture()

  const todo = fixture.addTask({ title: 'Task' })
  const project = fixture.addTask({ type: 1, title: 'Project' })

  for (const [uuid, action] of [
    [todo, 'update'],
    [project, 'update-project'],
  ] as const) {
    const result = await runTestCli(fixture, ['update', uuid, '--title', 'Renamed'])
    equal(result.launchedUrls.length, 1)

    const url = new URL(result.launchedUrls[0])
    equal(url.protocol, 'things:')
    equal(url.pathname, `/${action}`)
    deepStrictEqual(Object.fromEntries(url.searchParams), {
      id: uuid,
      'auth-token': 'test-token',
      title: 'Renamed',
    })
  }
})

test('update separates prepended and appended notes only from existing notes', async () => {
  using fixture = new ThingsFixture()

  const todoId = fixture.addTask({ title: 'Task', notes: 'Existing' })
  const result = await runTestCli(fixture, [
    'update',
    todoId,
    '--prepend-notes',
    'Before',
    '--append-notes',
    'After',
  ])
  const params = new URL(result.launchedUrls[0]).searchParams
  equal(params.get('prepend-notes'), 'Before\n')
  equal(params.get('append-notes'), '\nAfter')
})

test('update separates prepended from appended notes when notes are empty', async () => {
  using fixture = new ThingsFixture()

  const todoId = fixture.addTask({ title: 'Task' })
  const both = await runTestCli(fixture, [
    'update',
    todoId,
    '--prepend-notes',
    'Before',
    '--append-notes',
    'After',
  ])
  const params = new URL(both.launchedUrls[0]).searchParams
  equal(params.get('prepend-notes'), 'Before')
  equal(params.get('append-notes'), '\nAfter')

  for (const flag of ['--prepend-notes', '--append-notes']) {
    const single = await runTestCli(fixture, ['update', todoId, flag, 'Only'])
    const key = flag.slice(2)
    equal(new URL(single.launchedUrls[0]).searchParams.get(key), 'Only')
  }
})

test('update distinguishes empty fields from omitted fields', async () => {
  using fixture = new ThingsFixture()

  const todo = fixture.addTask({ title: 'Task' })
  const cases = [
    { args: ['--title', 'Renamed'], expected: { title: 'Renamed' } },
    { args: ['--notes', '', '--deadline', ''], expected: { notes: '', deadline: '' } },
    {
      args: ['--notes', 'Replacement', '--deadline', '2026-08-01'],
      expected: { notes: 'Replacement', deadline: '2026-08-01' },
    },
  ] as const

  for (const { args, expected } of cases) {
    const result = await runTestCli(fixture, ['update', todo, ...args])
    const params = new URL(result.launchedUrls[0]).searchParams
    deepStrictEqual(
      Object.fromEntries(
        [...params].filter(([key]) => key !== 'id' && key !== 'auth-token'),
      ),
      expected,
    )
  }
})

test('delete runs the AppleScript for the item type and refuses areas', async () => {
  using fixture = new ThingsFixture()

  const todo = fixture.addTask({ title: 'Task' })
  const project = fixture.addTask({ type: 1, title: 'Project' })
  const done = fixture.addTask({
    title: 'Done',
    status: 3,
    stopDate: unixSeconds('2026-01-03T04:05:06Z'),
  })
  const area = fixture.addArea({ title: 'Work' })

  const cases = [
    [todo, 'to do', 'Task', ''],
    [project, 'project', 'Project', ''],
    [done, 'to do', 'Done', ' of list "Logbook"'],
  ] as const
  for (const [uuid, cls, title, scope] of cases) {
    const result = await runTestCli(fixture, ['delete', uuid])
    equal(result.code, 0)
    deepStrictEqual(result.osascripts, [
      `tell application "Things3" to delete ${cls} id "${uuid}"${scope}`,
    ])
    equal(result.stdout, `Deleted: ${title}\n`)
    deepStrictEqual(result.launchedUrls, [])
  }

  for (const uuid of [area, 'nope']) {
    const result = await runTestCli(fixture, ['delete', uuid])
    equal(result.code, 1)
    deepStrictEqual(result.osascripts, [])
  }
})

test('item shows headings, and update and delete refuse them', async () => {
  using fixture = new ThingsFixture()

  const project = fixture.addTask({ type: 1, title: 'Launch' })
  const heading = fixture.addTask({ type: 2, title: 'Follow-up', project })

  for (const format of ['short', 'json']) {
    const item = await runTestCli(fixture, ['item', heading, '--format', format])
    equal(item.code, 0)
    equal(item.stdout, '[Heading] Follow-up (project: Launch)\n')
  }

  const link = await runTestCli(fixture, ['link', heading])
  equal(link.code, 0)
  equal(link.stdout.includes('Follow-up'), true)

  const deleted = await runTestCli(fixture, ['delete', heading])
  equal(deleted.code, 1)
  equal(deleted.stderr, 'Refusing to delete a heading\n')
  deepStrictEqual(deleted.osascripts, [])
})

test('update refuses unknown items, areas, and headings', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Launch' })
  const heading = fixture.addTask({ type: 2, title: 'Follow-up', project })

  const cases = [
    ['nope', 'Item not found: nope\n'],
    [area, 'Refusing to update an area\n'],
    [heading, 'Refusing to update a heading\n'],
  ] as const
  for (const [uuid, stderr] of cases) {
    const result = await runTestCli(fixture, ['update', uuid, '--title', 'Renamed'])
    equal(result.code, 1)
    equal(result.stderr, stderr)
    deepStrictEqual(result.launchedUrls, [])
    deepStrictEqual(result.osascripts, [])
  }
})

test('table distinguishes reserved area names from synthetic columns', async () => {
  using fixture = new ThingsFixture()

  const totalArea = fixture.addArea({ title: 'Total' })
  const completionsArea = fixture.addArea({ title: 'Completions' })
  const noAreaArea = fixture.addArea({ title: 'No area' })
  for (const area of [totalArea, completionsArea, noAreaArea, null]) {
    fixture.addTask({
      title: `Task in ${area ?? 'no area'}`,
      status: 3,
      area,
      creationDate: unixSeconds('2026-01-05T12:00:00Z'),
      stopDate: unixSeconds('2026-01-05T13:00:00Z'),
    })
  }

  const result = await runTestCli(fixture, ['table'])
  for (const header of [
    'Total',
    'Total (area)',
    'Completions',
    'Completions (area)',
    'No area',
    'No area (area)',
  ]) {
    equal(result.stdout.includes(header), true)
  }
})
