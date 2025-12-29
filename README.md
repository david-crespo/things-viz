# things-viz

This is a minimal read-only CLI for [Things 3](https://culturedcode.com/things/) data
written in TypeScript with [Deno](https://docs.deno.com/runtime/). The goal was originally
to generate charts showing trends in the number of tasks and the rate of completion (e.g.,
to see whether I'm even making a dent when I cancel 20 old tasks). More recently, I've added 
comprehensive coverage of Things views like Inbox and Today to give LLM agents the
ability to help with GTD-style task management.

## How to use

1. [Install Deno](https://docs.deno.com/runtime/getting_started/installation/)
2. Clone this repo
3. Set up an alias like `alias tviz=~/repos/things-viz/main.ts`

The needed permissions are built into the shebang at the top of [`main.ts`](./main.ts).

## How it works

Things 3 data is just a SQLite DB on disk. All we have to do is find the path and query it
with [`node:sqlite`](https://docs.deno.com/examples/sqlite/) (in `readOnly` mode to be
safe). See [`data.ts`](./data.ts).

## History

This was initially built around shelling out to the excellent
[`things-cli`](https://github.com/thingsapi/things-cli) to retrieve the data in JSON format.
In order to remove that external dependency, I then used LLMs to port the data layer to
TypeScript, iterating on the SQLite queries until the output matched the original.
