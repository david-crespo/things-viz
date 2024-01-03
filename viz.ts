#!/usr/bin/env deno run --allow-read

import { minBy, maxBy } from "https://deno.land/std@0.209.0/collections/mod.ts";

type RawGroup = {
  title: string;
  items: RawItem[];
};

type ItemBase = {
  uuid: string;
  type: "to-do" | "project" | "heading";
  title: string;
  status: "incomplete";
  area: string;
  area_title: string;
  // notes: "",
  // start: "Anytime",
  // start_date: null,
  // deadline: null,
  // stop_date: null,
  // index: -262068,
  // today_index: 0
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

// might not need this
// const areas = Object.fromEntries(
//   data.find((d) => d.title === "Areas")!.items.map((i) => [i.uuid, i.title]),
// );

const items: Item[] = data
  .flatMap((x) => {
    if (["No Area", "Areas"].includes(x.title)) return [];
    return x.items.filter((i) => i.type === "to-do");
  })
  .map((i) => ({
    ...i,
    created: new Date(i.created),
    stop_date: i.stop_date ? new Date(i.stop_date) : null,
  }));

function incrDay(d: Date) {
  const newDate = new Date(d.valueOf());
  newDate.setDate(newDate.getDate() + 1);
  return newDate;
}

function getDays(start: Date, end: Date) {
  const days: Date[] = [];
  for (let date = start; date <= end; date = incrDay(date)) {
    days.push(date);
  }
  return days;
}

const dateToStr = (d: Date) => d.toISOString().slice(0, 10);
const truncateDate = (d: Date) => new Date(dateToStr(d));

const identity = (x: any) => x;

/** Returns a new array sorted by `by`. Assumes return value of `by` is
 * comparable. Default value of `by` is the identity function. */
export function sortBy<T>(arr: T[], by: (t: T) => any = identity): T[] {
  const copy = [...arr];
  copy.sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0));
  return copy;
}

const counts: Record<string, number> = {};

// Create a dataset of days and counts. To start, all I care about is how
// many items are open on a given day, i.e., is that date between created and
// stop_date, inclusive. If an item is completed on a given day, we should
// consider it open on that day and closed on the next
for (const item of items) {
  const start = truncateDate(item.created);
  // if it is incomplete it is open for all days up to today
  const end = truncateDate(item.stop_date || new Date());
  getDays(start, end).forEach((d) => {
    const dateStr = dateToStr(d);
    if (!(dateStr in counts)) {
      counts[dateStr] = 0;
    }
    counts[dateStr] += 1;
  });
}

// turn into a list of data point objects, sorted by date
const output = sortBy(
  Object.entries(counts).map(([date, count]) => ({ date, count })),
  (d) => d.date,
);

console.log(output);
