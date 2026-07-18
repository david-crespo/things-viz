import { DatabaseSync } from 'node:sqlite'

const TEMP_ROOT = `${import.meta.dirname}/.tmp`

const SCHEMA = `
  CREATE TABLE TMArea (
    uuid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    "index" INTEGER NOT NULL
  );

  CREATE TABLE TMTask (
    uuid TEXT PRIMARY KEY,
    type INTEGER NOT NULL,
    title TEXT NOT NULL,
    status INTEGER NOT NULL,
    area TEXT,
    project TEXT,
    heading TEXT,
    notes TEXT,
    start INTEGER NOT NULL,
    startDate INTEGER,
    startBucket INTEGER NOT NULL,
    deadline INTEGER,
    stopDate REAL,
    creationDate REAL NOT NULL,
    userModificationDate REAL,
    "index" INTEGER NOT NULL,
    todayIndex INTEGER NOT NULL,
    trashed INTEGER NOT NULL,
    rt1_recurrenceRule BLOB
  );

  CREATE TABLE TMChecklistItem (
    task TEXT NOT NULL,
    uuid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status INTEGER NOT NULL,
    creationDate REAL,
    userModificationDate REAL,
    stopDate REAL,
    "index" INTEGER NOT NULL
  );
`

type TaskType = 0 | 1 | 2
type Status = 0 | 2 | 3
type Start = 0 | 1 | 2

type AreaInput = {
  uuid?: string
  title: string
  index?: number
}

export type TaskInput = {
  uuid?: string
  type?: TaskType
  title: string
  status?: Status
  area?: string | null
  project?: string | null
  heading?: string | null
  notes?: string | null
  start?: Start
  startDate?: number | null
  startBucket?: number
  deadline?: number | null
  stopDate?: number | null
  creationDate?: number
  modificationDate?: number | null
  index?: number
  todayIndex?: number
  trashed?: boolean
  recurrenceRule?: Uint8Array | null
}

type ChecklistItemInput = {
  uuid?: string
  task: string
  title: string
  status?: Status
  creationDate?: number | null
  modificationDate?: number | null
  stopDate?: number | null
  index?: number
}

export class ThingsFixture implements Disposable {
  readonly db: DatabaseSync
  readonly path: string

  #directory: string
  #nextArea = 0
  #nextTask = 0
  #nextChecklistItem = 0

  constructor() {
    Deno.mkdirSync(TEMP_ROOT, { recursive: true })
    this.#directory = Deno.makeTempDirSync({ dir: TEMP_ROOT, prefix: 'fixture-' })
    this.path = `${this.#directory}/main.sqlite`
    this.db = new DatabaseSync(this.path)
    this.db.exec(SCHEMA)
  }

  addArea(input: AreaInput): string {
    const sequence = ++this.#nextArea
    const uuid = input.uuid ?? `area-${sequence}`
    this.db.prepare('INSERT INTO TMArea (uuid, title, "index") VALUES (?, ?, ?)').run(
      uuid,
      input.title,
      input.index ?? sequence,
    )
    return uuid
  }

  addTask(input: TaskInput): string {
    const sequence = ++this.#nextTask
    const uuid = input.uuid ?? `task-${sequence}`
    this.db.prepare(
      `INSERT INTO TMTask (
        uuid, type, title, status, area, project, heading, notes,
        start, startDate, startBucket, deadline, stopDate,
        creationDate, userModificationDate, "index", todayIndex,
        trashed, rt1_recurrenceRule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuid,
      input.type ?? 0,
      input.title,
      input.status ?? 0,
      input.area ?? null,
      input.project ?? null,
      input.heading ?? null,
      input.notes ?? '',
      input.start ?? 1,
      input.startDate ?? null,
      input.startBucket ?? 0,
      input.deadline ?? null,
      input.stopDate ?? null,
      input.creationDate ?? unixSeconds('2026-01-01T12:00:00Z') + sequence,
      input.modificationDate ?? null,
      input.index ?? sequence,
      input.todayIndex ?? sequence,
      input.trashed ? 1 : 0,
      input.recurrenceRule ?? null,
    )
    return uuid
  }

  addChecklistItem(input: ChecklistItemInput): string {
    const sequence = ++this.#nextChecklistItem
    const uuid = input.uuid ?? `checklist-${sequence}`
    this.db.prepare(
      `INSERT INTO TMChecklistItem (
        task, uuid, title, status, creationDate,
        userModificationDate, stopDate, "index"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.task,
      uuid,
      input.title,
      input.status ?? 0,
      input.creationDate ?? unixSeconds('2026-01-01T12:00:00Z') + sequence,
      input.modificationDate ?? unixSeconds('2026-01-01T12:00:00Z') + sequence,
      input.stopDate ?? null,
      input.index ?? sequence,
    )
    return uuid
  }

  [Symbol.dispose]() {
    this.db.close()
    Deno.removeSync(this.#directory, { recursive: true })
  }
}

export function thingsDate(year: number, month: number, day: number): number {
  return (year << 16) | (month << 12) | (day << 7)
}

export function unixSeconds(iso: string): number {
  return new Date(iso).getTime() / 1000
}
