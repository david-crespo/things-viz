import { type CountPlotDatum, type CountRow, countsToPlotData } from './data.ts'

export function serializeInlineJson(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError('Value is not JSON serializable')
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export type DatedCount = { date: string; count: number }

export type AreaSelection =
  | { mode: 'all' }
  | { mode: 'subset'; areas: Set<string> }

export function reconcileAreaSelection(
  selection: AreaSelection,
  domain: string[],
): AreaSelection {
  if (selection.mode === 'all') return selection
  const available = new Set(domain)
  const areas = new Set([...selection.areas].filter((area) => available.has(area)))
  return areas.size === 0 ? { mode: 'all' } : { mode: 'subset', areas }
}

export function renderPlotHtml(template: string, data: unknown): string {
  return template
    .replace(
      '/*__RECONCILE_SELECTION__*/ (() => {})',
      `(${reconcileAreaSelection.toString()})`,
    )
    .replace('/*__DATA__*/ []', serializeInlineJson(data))
}

/** All plot series for the counts: per-area, totals, and a completion moving average. */
export function plotSeries(counts: CountRow[]): CountPlotDatum[] {
  const plotData = countsToPlotData(counts)
  const completions = plotData.filter(({ kind }) => kind === 'completions')
  // Today usually has no completions yet; drop it so it doesn't dilute the average.
  if (completions.at(-1)?.count === 0) completions.pop()
  const averages = movingAverage(completions, 30).map((point) => ({
    ...point,
    kind: 'completion-average' as const,
    area: 'completions',
    label: 'Completions',
  }))
  return [...plotData, ...averages]
}

export function movingAverage(data: DatedCount[], windowSize: number): DatedCount[] {
  const result: DatedCount[] = []
  let sum = 0
  let start = 0

  for (let index = 0; index < data.length; index++) {
    sum += data[index].count

    if (index - start + 1 === windowSize) {
      result.push({ date: data[index].date, count: sum / windowSize })
      sum -= data[start].count
      start++
    }
  }

  return result
}
