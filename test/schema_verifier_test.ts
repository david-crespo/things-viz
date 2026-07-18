import { deepStrictEqual, equal } from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { compareDatabaseSchemas, sqliteAffinity } from '../tools/verify-fixture-schema.ts'
import { ThingsFixture } from './fixture.ts'

Deno.test('schema verifier accepts the existing fixture metadata', () => {
  using fixture = new ThingsFixture()

  deepStrictEqual(compareDatabaseSchemas(fixture.db, fixture.db), [])
})

Deno.test('schema verifier reports missing tables, columns, and affinity drift', () => {
  using fixture = new ThingsFixture()
  using real = new DatabaseSync(':memory:')
  real.exec('CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, "index" TEXT NOT NULL)')

  const problems = compareDatabaseSchemas(fixture.db, real, ['TMArea', 'TMTask'])

  deepStrictEqual(problems, [
    'TMArea.title: column is absent from the real schema',
    'TMArea.index: affinity differs (fixture INTEGER, real TEXT)',
    'TMTask: table is absent from the real schema',
  ])
})

Deno.test('sqliteAffinity follows SQLite declared-type rules', () => {
  equal(sqliteAffinity('BIGINT'), 'INTEGER')
  equal(sqliteAffinity('VARCHAR(255)'), 'TEXT')
  equal(sqliteAffinity(''), 'BLOB')
  equal(sqliteAffinity('DOUBLE'), 'REAL')
  equal(sqliteAffinity('BOOLEAN'), 'NUMERIC')
})
