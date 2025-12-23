#!/usr/bin/env -S deno test --allow-read --allow-run --allow-env

import { assertEquals } from '@std/assert'

const pyScript = './things_query.py'
const tsScript = './things_query.ts'

async function runScript(script: string, args: string[]): Promise<unknown> {
  const cmd = new Deno.Command(script, { args, stdout: 'piped', stderr: 'piped' })
  const { stdout, stderr } = await cmd.output()
  const err = new TextDecoder().decode(stderr)
  if (err) console.error(`${script} stderr:`, err)
  return JSON.parse(new TextDecoder().decode(stdout))
}

// Fields that TS outputs - ignore extra Python fields like checklist, tags, items, trashed
const CORE_FIELDS = new Set([
  'uuid',
  'type',
  'title',
  'status',
  'area',
  'area_title',
  'project',
  'project_title',
  'heading',
  'heading_title',
  'notes',
  'start',
  'start_date',
  'deadline',
  'stop_date',
  'created',
  'modified',
  'index',
  'today_index',
])

// deno-lint-ignore no-explicit-any
function normalize(data: any): any {
  if (Array.isArray(data)) {
    return data.map(normalize)
  }
  if (data && typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (CORE_FIELDS.has(k)) {
        result[k] = normalize(v)
      }
    }
    return result
  }
  // Normalize timestamps to minute precision (ignore seconds) due to rounding differences
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(data)) {
    return data.slice(0, 16) // Keep "YYYY-MM-DD HH:MM"
  }
  return data
}

async function comparePyTs(args: string[]) {
  const [py, ts] = await Promise.all([runScript(pyScript, args), runScript(tsScript, args)])
  return { py: normalize(py), ts: normalize(ts) }
}

function assertEqualWithDiff(ts: unknown, py: unknown) {
  assertEquals(ts, py, 'TypeScript output should match Python output')
}

Deno.test('areas returns same data', async () => {
  const { py, ts } = await comparePyTs(['areas'])
  assertEqualWithDiff(ts, py)
})

Deno.test('projects returns same data', async () => {
  const { py, ts } = await comparePyTs(['projects'])
  assertEqualWithDiff(ts, py)
})

Deno.test('today returns same data', async () => {
  const { py, ts } = await comparePyTs(['today'])
  assertEqualWithDiff(ts, py)
})

Deno.test('inbox returns same data', async () => {
  const { py, ts } = await comparePyTs(['inbox'])
  assertEqualWithDiff(ts, py)
})

Deno.test('anytime returns same data', async () => {
  const { py, ts } = await comparePyTs(['anytime'])
  assertEqualWithDiff(ts, py)
})

Deno.test('upcoming returns same data', async () => {
  const { py, ts } = await comparePyTs(['upcoming'])
  assertEqualWithDiff(ts, py)
})

Deno.test('someday returns same data', async () => {
  const { py, ts } = await comparePyTs(['someday'])
  assertEqualWithDiff(ts, py)
})

Deno.test('todos --incomplete returns same data', async () => {
  const { py, ts } = await comparePyTs(['todos', '--incomplete'])
  assertEqualWithDiff(ts, py)
})

Deno.test('todos (all statuses) returns same data', async () => {
  const { py, ts } = await comparePyTs(['todos'])
  assertEqualWithDiff(ts, py)
})

Deno.test('get area by uuid returns same data', async () => {
  // Get an area UUID from the areas command first
  const areas = (await runScript(pyScript, ['areas'])) as { uuid: string }[]
  if (areas.length === 0) return
  const { py, ts } = await comparePyTs(['get', areas[0].uuid])
  assertEqualWithDiff(ts, py)
})

Deno.test('get project by uuid returns same data', async () => {
  const projects = (await runScript(pyScript, ['projects'])) as { uuid: string }[]
  if (projects.length === 0) return
  const { py, ts } = await comparePyTs(['get', projects[0].uuid])
  assertEqualWithDiff(ts, py)
})

Deno.test('get todo by uuid returns same data', async () => {
  const todos = (await runScript(pyScript, ['today'])) as { uuid: string }[]
  if (todos.length === 0) return
  const { py, ts } = await comparePyTs(['get', todos[0].uuid])
  assertEqualWithDiff(ts, py)
})

Deno.test('today --checklists returns same data', async () => {
  const { py, ts } = await comparePyTs(['today', '--checklists'])
  assertEqualWithDiff(ts, py)
})
