#!/usr/bin/env deno run --allow-read --allow-write

import { minBy, maxBy } from "https://deno.land/std@0.209.0/collections/mod.ts";
import dayjs from "npm:dayjs@1.11.10";

const identity = (x: any) => x;

/** Returns a new array sorted by `by`. Assumes return value of `by` is
 * comparable. Default value of `by` is the identity function. */
export function sortBy<T>(arr: T[], by: (t: T) => any = identity): T[] {
  const copy = [...arr];
  copy.sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0));
  return copy;
}

type RawGroup = {
  title: string;
  items: RawItem[];
};

type ItemBase = {
  uuid: string;
  type: "to-do" | "project" | "heading";
  title: string;
  status: "incomplete" | "completed";
  area?: string;
  area_title?: string;
  project?: string;
  project_title?: string;
};

type RawItem = ItemBase & {
  created: string;
  stop_date: string | null;
};

type Item = ItemBase & {
  created: Date;
  stop_date: Date | null;
};

// things-cli -j all > data.json
const data = JSON.parse(await Deno.readTextFile("./data.json")) as RawGroup[];

// console.log(data.map(({ title, items }) => ({ title, l: items.length })));

const projectAreas = Object.fromEntries(
  data
    .find((i) => i.title === "No Area")!
    .items.filter((i) => i.type === "project")
    .map((p) => [p.title, p.area_title]),
);

// console.log(data.find((i) => i.title === "Areas")!.items);

const headingAreas = {};

// TODO: do the same with heading areas. unclear whether this is possible, don't
// see how to get heading -> area association

const items: Item[] = data
  .filter((i) =>
    // No Area is projects
    // Areas is areas
    // Today is redundant -- items appear elsewhere
    ["Upcoming", "Anytime", "Someday", "Logbook"].includes(i.title),
  )
  .flatMap((x) => x.items.filter((i) => i.type === "to-do"))
  .map((i) => ({
    ...i,
    created: new Date(i.created),
    stop_date: i.stop_date ? new Date(i.stop_date) : null,
  }));

// console.log(
//   items.filter((i) => !i.area && !i.project && i.status === "incomplete"),
// );

const dateToStr = (d: Date) => d.toISOString().slice(0, 10);

function incrDay(d: string): string {
  return dayjs(d).add(1, "days").format("YYYY-MM-DD");
}

function getDays(start: string, end: string) {
  const days: string[] = [];
  for (let date = start; date <= end; date = incrDay(date)) {
    days.push(date);
  }
  return days;
}

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
  const area =
    item.area_title ||
    (item.project_title ? projectAreas[item.project_title] : undefined);

  getDays(start, end).forEach((date) => {
    const value = counts[date] || { "No area": 0 };

    // items in projects do not have the area directly on them. need to
    // look up the area for the project
    if (area) {
      value[area] = (value[area] || 0) + 1;
    } else {
      value["No area"] += 1;
    }
    counts[date] = value;
  });
}

// output for observable plot
const output = sortBy(
  Object.entries(counts).flatMap(([date, value]) =>
    Object.entries(value).map(([area, count]) => ({ date, area, count })),
  ),
  (d) => d.date,
);

await Deno.writeTextFile("output.json", JSON.stringify(output, null, "  "));

const outputTable = sortBy(
  Object.entries(counts).map(([date, value]) => ({ date, ...value })),
  (d) => d.date,
);
console.table(outputTable.slice(-10));
// console.log(output.slice(-10));

// TODO: get items under headings
