import $ from "https://deno.land/x/dax@0.39.2/mod.ts";

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

export const dateToStr = (d: Date) => d.toISOString().slice(0, 10);

const getAllData = () => $`things-cli -j all`.json() as unknown as RawGroup[];

export const getAllItems = async (): Promise<Item[]> =>
  (await getAllData())
    .filter((i) =>
      // No Area is projects
      // Areas is areas
      // Today is redundant -- items appear elsewhere
      ["Upcoming", "Anytime", "Someday", "Logbook"].includes(i.title)
    )
    .flatMap((x) => x.items.filter((i) => i.type === "to-do"))
    .map((i) => ({
      ...i,
      created: new Date(i.created),
      stop_date: i.stop_date ? new Date(i.stop_date) : null,
    }));

const identity = (x: any) => x;

/** Returns a new array sorted by `by`. Assumes return value of `by` is
 * comparable. Default value of `by` is the identity function. */
export function sortBy<T>(arr: T[], by: (t: T) => any = identity): T[] {
  const copy = [...arr];
  copy.sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0));
  return copy;
}

export function sum(nums: number[]) {
  let result = 0;
  for (const num of nums) {
    result += num;
  }
  return result;
}
