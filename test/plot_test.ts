import { deepStrictEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'

import {
  movingAverage,
  plotSeries,
  reconcileAreaSelection,
  renderPlotHtml,
  serializeInlineJson,
} from '../plot.ts'
import plotTemplate from '../plot.html' with { type: 'text' }
import { getCounts } from '../data.ts'
import { ThingsFixture } from './fixture.ts'

test('serializeInlineJson cannot terminate its script element', () => {
  const value = [{ area: '</ScRiPt><script>globalThis.injected=true</script>' }]
  const serialized = serializeInlineJson(value)

  equal(/<\/script/i.test(serialized), false)
  deepStrictEqual(JSON.parse(serialized), value)
})

test('movingAverage dates each full window at its trailing edge', () => {
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

test('plotSeries drops a trailing zero-completion day from the average', () => {
  const counts = Array.from({ length: 31 }, (_, index) => ({
    date: Temporal.PlainDate.from('2026-01-01').add({ days: index }).toString(),
    total: 1,
    completions: index === 30 ? 0 : 1,
    unassigned: 0,
    areas: {},
  }))

  const averages = plotSeries(counts).filter(({ kind }) => kind === 'completion-average')

  deepStrictEqual(averages, [
    {
      date: '2026-01-30',
      count: 1,
      kind: 'completion-average',
      area: 'completions',
      label: 'Completions',
    },
  ])
})

test('getCounts ends open items today so plotSeries trims today', async () => {
  const startOfToday = Temporal.Now.zonedDateTimeISO().startOfDay()
  const today = startOfToday.toPlainDate().toString()
  const yesterday = startOfToday.subtract({ days: 1 })
  const seconds = (dt: Temporal.ZonedDateTime) => dt.epochMilliseconds / 1000
  const longAgo = seconds(startOfToday.subtract({ days: 40 }).add({ hours: 12 }))

  {
    using fixture = new ThingsFixture()
    fixture.addTask({ title: 'Open', creationDate: longAgo })
    fixture.addTask({
      title: 'Done earlier today',
      status: 3,
      creationDate: longAgo,
      stopDate: seconds(startOfToday),
    })

    const counts = await getCounts({ dbPath: fixture.path })
    deepStrictEqual(counts.at(-1), {
      date: today,
      total: 2,
      completions: 1,
      unassigned: 2,
      areas: {},
    })
  }

  {
    using fixture = new ThingsFixture()
    fixture.addTask({ title: 'Open', creationDate: longAgo })
    fixture.addTask({
      title: 'Done yesterday',
      status: 3,
      creationDate: longAgo,
      stopDate: seconds(yesterday.add({ hours: 12 })),
    })

    const counts = await getCounts({ dbPath: fixture.path })
    equal(counts.at(-1)?.date, today)
    equal(counts.at(-1)?.completions, 0)
    const averages = plotSeries(counts).filter(({ kind }) => kind === 'completion-average')
    deepStrictEqual(averages.at(-1), {
      date: yesterday.toPlainDate().toString(),
      count: 1 / 30,
      kind: 'completion-average',
      area: 'completions',
      label: 'Completions',
    })
  }
})

test('renderPlotHtml inlines the data into a full page', () => {
  const html = renderPlotHtml(plotTemplate, [{ area: 'Work' }])

  equal(html.includes('</html>'), true)
  equal(html.includes('"Work"'), true)
})

test('reconcileAreaSelection preserves all-vs-subset intent across domains', () => {
  const expandedDomain = ['area:Archived', 'area:Current']

  deepStrictEqual(reconcileAreaSelection({ mode: 'all' }, ['area:Current']), {
    mode: 'all',
  })
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
