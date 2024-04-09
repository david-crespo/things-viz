export const dateToStr = (d: Date) => d.toISOString().slice(0, 10)

// deno-lint-ignore no-explicit-any
const identity = (x: any) => x

/** Returns a new array sorted by `by`. Assumes return value of `by` is
 * comparable. Default value of `by` is the identity function. */
// deno-lint-ignore no-explicit-any
export function sortBy<T>(arr: T[], by: (t: T) => any = identity): T[] {
  const copy = [...arr]
  copy.sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : 0))
  return copy
}
