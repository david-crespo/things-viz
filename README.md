# things-viz

This is a minimal read-only CLI for [Things 3](https://culturedcode.com/things/) data
written in TypeScript for [Node.js](https://nodejs.org/). The goal was originally to
generate charts showing trends in the number of tasks and the rate of completion (e.g., to
see whether I'm even making a dent when I cancel 20 old tasks). More recently, I've added
comprehensive coverage of Things views like Inbox and Today to give LLM agents the ability
to help with GTD-style task management.

```
$ tviz -h
Usage: tviz [options] [command]

Visualize Things 3 data

Options:
  -h, --help               display help for command

Commands:
  table                    print table of the last 30 days
  plot                     run server showing plot
  logbook [options]        list completed items
  todos [options]          list items
  areas [options]          list all areas
  projects [options]       list projects
  today [options]          list tasks in Today view
  inbox [options]          list tasks in Inbox
  anytime [options]        list tasks in Anytime view (no schedule, ready to do)
  upcoming [options]       list tasks in Upcoming view (scheduled for future)
  someday [options]        list tasks in Someday view (deferred)
  link <uuid>              output OSC 8 hyperlink for a Things item
  item [options] <uuid>    show a single item by uuid
  add                      create items via Things URL scheme
  delete <uuid>            move an item to the Things trash
  update [options] <uuid>  update an existing item via Things URL scheme
```

<img width="994" height="639" alt="tviz plot showing line graph of items by area over time" src="https://github.com/user-attachments/assets/b62073be-82e8-45f8-bea7-a05167ad14fa" />

## How to use

1. Install [Node.js](https://nodejs.org/) 26 or later (see
   [`.node-version`](./.node-version))
2. Clone this repo and run `npm install`
3. Set up an alias like `alias tviz=~/repos/things-viz/main.ts`

Node runs the TypeScript directly, so there's no build step.

## How it works

Things 3 data is just a SQLite DB on disk. All we have to do is find the path and query it
with [`node:sqlite`](https://nodejs.org/api/sqlite.html) (in `readOnly` mode to be safe).
See [`data.ts`](./data.ts).

## Testing

```sh
npm test
npm run ci # format check, lint, typecheck, and tests
```

CLI tests run the real `main.ts` as a subprocess against a fresh fixture database under
`test/.tmp` (see [`test/cli.ts`](./test/cli.ts)).

We use Node's [permission model](https://nodejs.org/api/permissions.html) to guarantee tests
don't touch real Things data. The test runner can only write under `test/.tmp`, and the CLI
subprocess gets its own flags: it can only read within this repo (a real Things database is
unreachable), and cannot write or use the network. Node can't limit which programs a child
process runs, so the subprocess's `PATH` contains only stubs for `open` and `osascript` that
record their arguments instead of running, since `add`/`update` URLs and `delete`
AppleScript would otherwise write to the real Things app. Any accidental attempt to reach
outside fails loudly with `ERR_ACCESS_DENIED`.

Two gaps in Node's model are covered separately. `node:sqlite` doesn't check read
permissions, so every database open goes through `openDatabase` in [`data.ts`](./data.ts),
which checks them itself, and a test confirms it refuses a path outside the repo. Node also
can't restrict environment variables, so `npm test` unsets `THINGSDB` and `NODE_OPTIONS`,
and the CLI subprocess gets an explicit environment.

## History

This was initially built around shelling out to the excellent
[`things-cli`](https://github.com/thingsapi/things-cli) (powered by
[`things.py`](https://github.com/thingsapi/things.py)) to retrieve the data in JSON format.
In order to remove that external dependency, I then used LLMs to port the data layer to
TypeScript, iterating on the SQLite queries until the output matched the original. SQL
queries from `things.py` were not copied directly.
