import { deepStrictEqual, equal } from 'node:assert/strict'

import {
  movingAverage,
  plotSeries,
  reconcileAreaSelection,
  renderPlotHtml,
  serializeInlineJson,
} from '../plot.ts'
import plotTemplate from '../plot.html' with { type: 'text' }

Deno.test('serializeInlineJson cannot terminate its script element', () => {
  const value = [{ area: '</ScRiPt><script>globalThis.injected=true</script>' }]
  const serialized = serializeInlineJson(value)

  equal(/<\/script/i.test(serialized), false)
  deepStrictEqual(JSON.parse(serialized), value)
})

Deno.test('movingAverage dates each full window at its trailing edge', () => {
  const data = Array.from({ length: 31 }, (_, index) => ({
    date: Temporal.PlainDate.from('2026-01-01').add({ days: index }).toString(),
    count: index + 1,
  }))

  deepStrictEqual(movingAverage(data.slice(0, 29), 30), [])
  deepStrictEqual(movingAverage(data.slice(0, 30), 30), [
    { date: '2026-01-30', count: 15.5 },
  ])
  deepStrictEqual(movingAverage(data, 30), [
    { date: '2026-01-30', count: 15.5 },
    { date: '2026-01-31', count: 16.5 },
  ])
})

Deno.test('plotSeries drops a trailing zero-completion day from the average', () => {
  const counts = Array.from({ length: 31 }, (_, index) => ({
    date: Temporal.PlainDate.from('2026-01-01').add({ days: index }).toString(),
    total: 1,
    completions: index === 30 ? 0 : 1,
    unassigned: 0,
    areas: {},
  }))

  const averages = plotSeries(counts).filter(({ kind }) => kind === 'completion-average')

  deepStrictEqual(averages, [{
    date: '2026-01-30',
    count: 1,
    kind: 'completion-average',
    area: 'completions',
    label: 'Completions',
  }])
})

Deno.test('renderPlotHtml inlines the data into a full page', () => {
  const html = renderPlotHtml(plotTemplate, [{ area: 'Work' }])

  equal(html.includes('</html>'), true)
  equal(html.includes('"Work"'), true)
})

Deno.test('reconcileAreaSelection preserves all-vs-subset intent across domains', () => {
  const expandedDomain = ['area:Archived', 'area:Current']

  deepStrictEqual(
    reconcileAreaSelection({ mode: 'all' }, ['area:Current']),
    { mode: 'all' },
  )
  deepStrictEqual(
    reconcileAreaSelection(
      { mode: 'subset', areas: new Set(['area:Current']) },
      expandedDomain,
    ),
    { mode: 'subset', areas: new Set(['area:Current']) },
  )

  const contracted = reconcileAreaSelection(
    { mode: 'subset', areas: new Set(['area:Archived']) },
    ['area:Current'],
  )
  deepStrictEqual(contracted, { mode: 'all' })
  deepStrictEqual(reconcileAreaSelection(contracted, expandedDomain), { mode: 'all' })
})
