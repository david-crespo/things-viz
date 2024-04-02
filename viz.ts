#!/usr/bin/env deno run --allow-env --allow-read --allow-write --allow-run=things-cli

import { maxBy, minBy } from "https://deno.land/std@0.209.0/collections/mod.ts";
import dayjs from "npm:dayjs@1.11.10";
import memoize from "npm:memoize";
import { dateToStr, getAllItems, sortBy, sum } from "./util.ts";

const root = "/Users/david/repos/things-viz";

const items = await getAllItems();

const projectAreas = Object.fromEntries(
  items
    .filter((i) => i.type === "project")
    .map((p) => [p.uuid, { project_title: p.title, area_title: p.area_title }]),
);

// memoizing here cuts the whole script down from over 1s to like 100ms
const incrDay = memoize((d: string) =>
  dayjs(d).add(1, "days").format("YYYY-MM-DD")
);

const tomorrow = incrDay(dateToStr(new Date()));

const counts: Record<string, Record<string, number>> = {};

// Create a dataset of days and counts. To start, all I care about is how
// many items are open on a given day, i.e., is that date between created and
// stop_date, inclusive. If an item is completed on a given day, we should
// consider it open on that day and closed on the next
for (const item of items) {
  const start = dateToStr(item.created);
  // if it is incomplete it is open for all days up to today. but
  // actually go up to tomorrow to see items completed today
  const end = item.stop_date ? dateToStr(item.stop_date) : tomorrow;
  const area = item.area_title ||
    (item.project ? projectAreas[item.project]?.area_title : undefined);

  for (let date = start; date <= end; date = incrDay(date)) {
    const value = counts[date] || { "No area": 0 };

    // items in projects do not have the area directly on them. need to
    // look up the area for the project
    if (area) {
      value[area] = (value[area] || 0) + 1;
    } else {
      value["No area"] += 1;
    }
    counts[date] = value;
  }
}

// output for observable plot
const output = sortBy(
  Object.entries(counts).flatMap(([date, value]) => {
    const entries = Object.entries(value);
    return [...entries.map(([area, count]) => ({ date, area, count })), {
      date,
      area: "Total",
      count: sum(entries.map(([_area, count]) => count)),
    }];
  }),
  (d) => d.date,
);
await Deno.writeTextFile(
  root + "/output.json",
  JSON.stringify(output, null, "  "),
);

const outputTable = sortBy(
  Object.entries(counts).map(([date, value]) => ({
    date,
    ...value,
    Total: Object.values(value).reduce((a, b) => a + b, 0),
  })),
  (d) => d.date,
);
console.table(outputTable.slice(-20));

// TODO: get items under headings
