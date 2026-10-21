import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { text } from 'node:stream/consumers'

import type { ThingsFixture } from './fixture.ts'

const ROOT = new URL('..', import.meta.url).pathname

export type CliTestResult = {
  code: number
  stdout: string
  stderr: string
  launchedUrls: string[]
  osascripts: string[]
}

/**
 * Run the real CLI as a subprocess against a fixture database.
 *
 * The permission flags below are the safety boundary that keeps tests away from real
 * data, so do not loosen them to fix a failing test. The child can only read within
 * this repo (a real Things database, under ~/Library, is unreachable), and cannot write
 * or use the network at all. node:sqlite skips the read check, so `openDatabase` in
 * data.ts does it. Node can't limit which programs a child runs, so PATH holds only
 * the stubs below, which record their arguments instead of running: `open` and
 * `osascript` by name reach nothing else. The stubs matter as much as the read sandbox:
 * `add`/`update` tests produce `things:///` URLs and `delete` tests produce AppleScript
 * that would otherwise write to the real Things app.
 */
export async function runTestCli(
  fixture: ThingsFixture,
  args: string[],
  options: {
    stdin?: string
    token?: string | null
    timeZone?: string
    // Points THINGSDB somewhere other than the fixture
    dbPath?: string
  } = {},
): Promise<CliTestResult> {
  const fixtureDir = dirname(fixture.path)
  const binDir = `${fixtureDir}/bin`
  const openLog = `${fixtureDir}/open.log`
  const osascriptLog = `${fixtureDir}/osascript.log`
  const timeZone = options.timeZone ?? process.env.TZ
  mkdirSync(binDir, { recursive: true })
  writeFileSync(`${binDir}/open`, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${openLog}'\n`, {
    mode: 0o755,
  })
  // Records the script passed via `-e`.
  writeFileSync(
    `${binDir}/osascript`,
    `#!/bin/sh\nprintf '%s\\n' "$2" >> '${osascriptLog}'\n`,
    { mode: 0o755 },
  )

  const child = spawn(
    process.execPath,
    // Safety boundary; see the doc comment above before adding a permission.
    [
      // Node warns on stderr that --allow-child-process weakens the model
      '--disable-warning=PERM0002',
      '--permission',
      `--allow-fs-read=${ROOT}`,
      '--allow-child-process',
      `${ROOT}main.ts`,
      ...args,
    ],
    {
      // Replaces the environment rather than adding to it
      env: {
        NO_COLOR: '1',
        PATH: binDir,
        HOME: process.env.HOME ?? '',
        ...(timeZone ? { TZ: timeZone } : {}),
        THINGSDB: options.dbPath ?? fixture.path,
        // An empty value (rather than unset) keeps the repo's real .env from supplying a
        // token via dotenv, which only fills in variables that are not already set.
        THINGS_TOKEN: options.token === null ? '' : (options.token ?? 'test-token'),
      },
    },
  )
  // Without input, stdin is just closed, like /dev/null
  child.stdin.end(options.stdin)
  const [stdout, stderr, [code]] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, 'close'),
  ])

  return {
    code,
    stdout,
    stderr,
    launchedUrls: readLog(openLog),
    osascripts: readLog(osascriptLog),
  }
}

function readLog(path: string): string[] {
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
    rmSync(path)
    return lines
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
}
