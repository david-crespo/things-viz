#!/usr/bin/env -S deno test --allow-read --allow-write --allow-run --allow-env

import { assertSnapshot } from '@std/testing/snapshot'
import {
  getAllItems,
  getAreas,
  getCounts,
  getItemByUuid,
  getProjects,
  getViewItems,
  type Todo,
} from './data.ts'

// Transform to stable format for snapshots
function toSnapshot(todos: Todo[]) {
  return todos.map((todo) => ({
    uuid: todo.uuid,
    title: todo.title,
    area: todo.area_title,
    project: todo.project_title || null,
    notes: todo.notes || null,
    created: todo.created.toISOString(),
    modified: todo.modified?.toISOString() || null,
    start: todo.start,
    start_date: todo.start_date?.toISOString().slice(0, 10) || null,
    deadline: todo.deadline?.toISOString().slice(0, 10) || null,
    checklist: todo.checklist || null,
  }))
}

Deno.test('todos', async (t) => {
  const items = await getAllItems({ incompleteOnly: true })
  await assertSnapshot(t, toSnapshot(items))
})

Deno.test('todos --all', async (t) => {
  const items = await getAllItems({ incompleteOnly: false })
  await assertSnapshot(t, toSnapshot(items))
})

Deno.test('todos --completed', async (t) => {
  const items = await getAllItems({ incompleteOnly: false })
  const completed = items.filter((i) => i.status === 'completed')
  await assertSnapshot(t, toSnapshot(completed))
})

Deno.test('areas', async (t) => {
  await assertSnapshot(t, await getAreas())
})

Deno.test('projects', async (t) => {
  const projects = await getProjects()
  projects.sort((a, b) =>
    `${a.area_title}${a.title}`.localeCompare(`${b.area_title}${b.title}`)
  )
  const snapshot = projects.map((p) => ({
    area: p.area_title,
    project: p.title,
    start: p.start,
    start_date: p.start_date?.toISOString().slice(0, 10) || null,
    deadline: p.deadline?.toISOString().slice(0, 10) || null,
    created: p.created?.toISOString() || null,
  }))
  await assertSnapshot(t, snapshot)
})

Deno.test('today', async (t) => {
  await assertSnapshot(t, toSnapshot(await getViewItems('today')))
})

Deno.test('inbox', async (t) => {
  await assertSnapshot(t, toSnapshot(await getViewItems('inbox')))
})

Deno.test('anytime', async (t) => {
  await assertSnapshot(t, toSnapshot(await getViewItems('anytime')))
})

Deno.test('upcoming', async (t) => {
  await assertSnapshot(t, toSnapshot(await getViewItems('upcoming')))
})

Deno.test('someday', async (t) => {
  await assertSnapshot(t, toSnapshot(await getViewItems('someday')))
})

Deno.test('getItemByUuid - todo', async (t) => {
  const item = await getItemByUuid('JecmW1SNmcKgd7eFdSfpSg')
  await assertSnapshot(t, item)
})

Deno.test('getItemByUuid - project', async (t) => {
  const item = await getItemByUuid('3r7ywqnwv8uRoJ4jEYF7Lj')
  await assertSnapshot(t, item)
})

Deno.test('getCounts', async (t) => {
  const counts = await getCounts()
  await assertSnapshot(t, counts)
})
