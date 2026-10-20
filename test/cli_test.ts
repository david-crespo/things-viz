import { deepStrictEqual, equal } from 'node:assert/strict'
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

Deno.test('todos --all --format json runs through the CLI against a fixture', async () => {
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
  deepStrictEqual(output.map(({ title, status }) => ({ title, status })), [
    { title: 'Write summary', status: 'incomplete' },
    { title: 'Already shipped', status: 'completed' },
  ])
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

Deno.test('item --format json preserves evening state from todos', async () => {
  using fixture = new ThingsFixture()

  const evening = fixture.addTask({ title: 'Evening task', startBucket: 1 })
  const daytime = fixture.addTask({ title: 'Daytime task', startBucket: 0 })
  const stateSchema = z.array(z.object({ uuid: z.string(), evening: z.boolean() }))

  const todosResult = await runTestCli(fixture, ['todos', '--format', 'json'])
  const todos = stateSchema.parse(JSON.parse(todosResult.stdout))
  const listedStates = new Map(todos.map((todo) => [todo.uuid, todo.evening]))

  for (const [uuid, expected] of [[evening, true], [daytime, false]] as const) {
    equal(listedStates.get(uuid), expected)

    const itemResult = await runTestCli(fixture, ['item', uuid, '--format', 'json'])
    deepStrictEqual(stateSchema.parse(JSON.parse(itemResult.stdout)), [
      { uuid, evening: expected },
    ])
  }
})

Deno.test('item captures exact area and project output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const project = fixture.addTask({ type: 1, title: 'Launch', area })

  for (
    const [uuid, expected] of [
      [area, '[Area] Work\n'],
      [project, '[Project] Launch\n'],
    ] as const
  ) {
    const result = await runTestCli(fixture, ['item', uuid])
    equal(result.stdout, expected)
  }
})

Deno.test('item shows project notes in pretty and json output', async () => {
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

Deno.test('todos captures exact TSV output', async () => {
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

Deno.test('todos captures exact pretty output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  const todo = fixture.addTask({
    title: 'Write summary',
    area,
    notes: 'First line\nSecond line',
    creationDate: unixSeconds('2026-01-02T18:04:00Z'),
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

Deno.test('areas captures exact TSV output', async () => {
  using fixture = new ThingsFixture()

  fixture.addArea({ title: 'Work' })
  fixture.addArea({ title: 'Home\nAdmin' })

  const result = await runTestCli(fixture, ['areas', '--format', 'tsv'])

  equal(result.stdout, 'area\nHome Admin\nWork\n')
})

Deno.test('projects captures exact short output', async () => {
  using fixture = new ThingsFixture()

  const area = fixture.addArea({ title: 'Work' })
  fixture.addTask({ type: 1, title: 'Launch', area })

  const result = await runTestCli(fixture, ['projects', '--format', 'short'])

  equal(result.stdout, '[Work] Launch\n')
})

Deno.test('CLI reports validation and domain failures on stderr', async () => {
  using fixture = new ThingsFixture()

  // Cliffy prints usage to stdout and the error itself to stderr
  const invalidFormat = await runTestCli(fixture, ['todos', '--format', 'xml'])
  equal(invalidFormat.code, 2)
  equal(invalidFormat.stdout.includes('Usage:'), true)
  equal(invalidFormat.stderr.includes("Invalid format argument 'xml'"), true)

  const missingItem = await runTestCli(fixture, ['item', 'missing'])
  equal(missingItem.code, 1)
  equal(missingItem.stdout, '')
  equal(missingItem.stderr, 'Item not found: missing\n')
})

Deno.test('CLI prints help and reports parser failures', async () => {
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

  for (const args of [[], ['unknown']]) {
    const result = await runTestCli(fixture, args)
    equal(result.code, 2)
    equal(result.stderr.includes('error'), true)
  }
})

Deno.test('todos applies representative CLI filters', async () => {
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

Deno.test('views and logbook run through CLI actions', async () => {
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

Deno.test('link and add commands return terminal output and URL effects', async () => {
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
  deepStrictEqual(
    Object.fromEntries(new URL(addTodo.launchedUrls[0]).searchParams),
    { title: 'New task', list: 'Work', notes: 'Notes', 'checklist-items': 'First' },
  )

  const addProject = await runTestCli(fixture, [
    'add',
    'project',
    'Launch',
    '--heading',
    'Plan',
  ])
  const projectUrl = new URL(addProject.launchedUrls[0])
  equal(projectUrl.pathname, '/json')
  deepStrictEqual(JSON.parse(projectUrl.searchParams.get('data') ?? ''), [{
    type: 'project',
    attributes: {
      title: 'Launch',
      items: [{ type: 'heading', attributes: { title: 'Plan' } }],
    },
  }])
})

Deno.test('update dispatches to the URL command for the item type', async () => {
  using fixture = new ThingsFixture()

  const todo = fixture.addTask({ title: 'Task' })
  const project = fixture.addTask({ type: 1, title: 'Project' })

  for (const [uuid, action] of [[todo, 'update'], [project, 'update-project']] as const) {
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

Deno.test('update separates prepended and appended notes only from existing notes', async () => {
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

Deno.test('update distinguishes empty fields from omitted fields', async () => {
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

Deno.test('delete runs the AppleScript for the item type and refuses areas', async () => {
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

Deno.test('table distinguishes reserved area names from synthetic columns', async () => {
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
  for (
    const header of [
      'Total',
      'Total (area)',
      'Completions',
      'Completions (area)',
      'No area',
      'No area (area)',
    ]
  ) {
    equal(result.stdout.includes(header), true)
  }
})
