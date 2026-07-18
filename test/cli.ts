import { dirname } from 'node:path'

import type { ThingsFixture } from './fixture.ts'

const ROOT = new URL('..', import.meta.url).pathname

export type CliTestResult = {
  code: number
  stdout: string
  stderr: string
  launchedUrls: string[]
}

/**
 * Run the real CLI as a subprocess against a fixture database.
 *
 * The permission flags below are the safety boundary that keeps tests away from real
 * data, so do not loosen them to fix a failing test. The child can only read within
 * this repo (a real Things database, under ~/Library, is unreachable), cannot write
 * or use the network at all, and can run only `open` — which resolves to the stub
 * below that records URLs instead of launching them. The stub matters as much as the
 * read sandbox: `add`/`update` tests produce `things:///` URLs that would otherwise
 * write to the real Things app.
 */
export async function runTestCli(
  fixture: ThingsFixture,
  args: string[],
  options: { stdin?: string; token?: string | null } = {},
): Promise<CliTestResult> {
  const fixtureDir = dirname(fixture.path)
  const binDir = `${fixtureDir}/bin`
  const openLog = `${fixtureDir}/open.log`
  Deno.mkdirSync(binDir, { recursive: true })
  Deno.writeTextFileSync(
    `${binDir}/open`,
    `#!/bin/sh\nprintf '%s\\n' "$1" >> '${openLog}'\n`,
    { mode: 0o755 },
  )

  const child = new Deno.Command('deno', {
    // Safety boundary; see the doc comment above before adding a permission.
    args: [
      'run',
      '--no-prompt',
      `--allow-read=${ROOT}`,
      '--allow-env',
      '--allow-run=open',
      `${ROOT}main.ts`,
      ...args,
    ],
    clearEnv: true,
    env: {
      NO_COLOR: '1',
      PATH: `${binDir}:${Deno.env.get('PATH')}`,
      HOME: Deno.env.get('HOME') ?? '',
      ...(Deno.env.get('TZ') ? { TZ: Deno.env.get('TZ')! } : {}),
      THINGSDB: fixture.path,
      // An empty value (rather than unset) keeps the repo's real .env from supplying a
      // token via dotenv, which only fills in variables that are not already set.
      THINGS_TOKEN: options.token === null ? '' : options.token ?? 'test-token',
    },
    stdin: options.stdin === undefined ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()

  if (options.stdin !== undefined) {
    const writer = child.stdin.getWriter()
    await writer.write(new TextEncoder().encode(options.stdin))
    await writer.close()
  }
  const { code, stdout, stderr } = await child.output()

  let launchedUrls: string[] = []
  try {
    launchedUrls = Deno.readTextFileSync(openLog).trimEnd().split('\n')
    Deno.removeSync(openLog)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }

  const decoder = new TextDecoder()
  return {
    code,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
    launchedUrls,
  }
}
