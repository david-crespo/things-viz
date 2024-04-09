#!/usr/bin/env deno run --allow-env --allow-read --allow-run=things-cli,fzf,open

import $ from 'https://deno.land/x/dax@0.39.2/mod.ts'
import { dateToStr } from './util.ts'
import { getAllItems } from './data.ts'

const allItems = await getAllItems()

const items = allItems.map((i) => {
  const complete = !!i.stop_date
  const date = dateToStr(i.stop_date || i.created)
  return [i.uuid, complete ? '[x]' : '[ ]', date, i.title]
}).sort(([a_id, a_complete, a_date], [b_id, b_complete, b_date]) => {
  // sort open items last, and then by most recent last within complete
  if (a_complete === b_complete) return -1 * a_date.localeCompare(b_date)
  return a_complete.localeCompare(b_complete)
})

const input = items.map((i) => i.join(' ')).join('\n')
// --no-sort to preserve our sorting
const selectedLine = await $`echo ${input} | fzf --no-sort --with-nth 2..`
  .text()
const [id, ...rest] = selectedLine.split(' ')

const url = `things:///show?id=${id}`
console.log(`selected: ${rest.join(' ')}`)
console.log(`opening: ${url}`)
await $`open ${url}`

// echo 'abc|def\nghi|xyz' | fzf --delimiter="|" --nth=2,3 --with-nth=2 --preview 'echo {}'
