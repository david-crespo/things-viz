// Check that the test fixture's schema still matches the real Things database: every
// fixture column must exist in the real schema with the same SQLite type affinity.
// Reads schema metadata only, never task rows.
//
//   deno task verify:real-schema

import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

import { findDatabasePath } from '../data.ts'
import { ThingsFixture } from '../test/fixture.ts'

const THINGS_TABLES = ['TMArea', 'TMTask', 'TMChecklistItem']

// https://sqlite.org/datatype3.html#determination_of_column_affinity
export function sqliteAffinity(declaredType: string): string {
  const type = declaredType.toUpperCase()
  if (type.includes('INT')) return 'INTEGER'
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'TEXT'
  if (type === '' || type.includes('BLOB')) return 'BLOB'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'REAL'
  return 'NUMERIC'
}

const columnSchema = z.object({ name: z.string(), type: z.string() })

function columnAffinities(db: DatabaseSync, table: string): Map<string, string> {
  const rows = z
    .array(columnSchema)
    .parse(db.prepare('SELECT name, type FROM pragma_table_xinfo(?)').all(table))
  return new Map(rows.map(({ name, type }) => [name, sqliteAffinity(type)]))
}

/** Returns a list of problems, empty if the schemas are compatible. */
export function compareDatabaseSchemas(
  fixtureDb: DatabaseSync,
  realDb: DatabaseSync,
  tables: readonly string[] = THINGS_TABLES,
): string[] {
  const problems: string[] = []
  for (const table of tables) {
    const real = columnAffinities(realDb, table)
    if (real.size === 0) {
      problems.push(`${table}: table is absent from the real schema`)
      continue
    }
    for (const [name, affinity] of columnAffinities(fixtureDb, table)) {
      const realAffinity = real.get(name)
      if (realAffinity === undefined) {
        problems.push(`${table}.${name}: column is absent from the real schema`)
      } else if (realAffinity !== affinity) {
        problems.push(
          `${table}.${name}: affinity differs (fixture ${affinity}, real ${realAffinity})`,
        )
      }
    }
  }
  return problems
}

if (import.meta.main) {
  const realPath = await findDatabasePath()
  console.error(`Things database: ${realPath}`)

  using fixture = new ThingsFixture()
  using real = new DatabaseSync(realPath, { readOnly: true })
  const problems = compareDatabaseSchemas(fixture.db, real)

  for (const problem of problems) console.error(`FAIL: ${problem}`)
  if (problems.length === 0) console.log('PASS: fixture matches the real schema')
  process.exit(problems.length === 0 ? 0 : 1)
}
