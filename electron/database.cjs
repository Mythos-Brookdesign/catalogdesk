const { DatabaseSync } = require('node:sqlite')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { z } = require('zod')

const text = z.string().max(10 * 1024 * 1024)
const productSchema = z
  .object({
    sku: text,
    name: text,
    price: text,
    stock: text,
    category: text,
    description: text,
  })
  .strict()
const mappingSchema = z
  .object({
    sku: z.string(),
    name: z.string(),
    price: z.string(),
    stock: z.string(),
    category: z.string(),
    description: z.string(),
  })
  .strict()
const snapshotSchema = z
  .object({
    filename: z.string().min(1).max(255),
    demo: z.boolean(),
    dataset: z
      .object({
        headers: z.array(z.string().min(1)).min(2).max(1000),
        rows: z.array(z.array(text).max(1000)).min(1).max(50_000),
        delimiter: z.enum([',', ';', '\t', '|', '\u001e', '\u001f']),
      })
      .strict(),
    mapping: mappingSchema,
    options: z
      .object({
        trim: z.boolean(),
        normalizePrices: z.boolean(),
        priceFormat: z.enum(['de', 'en']),
      })
      .strict(),
    edits: z.record(
      z.string().regex(/^(0|[1-9]\d*)$/),
      productSchema.partial(),
    ),
    excluded: z.array(z.number().int().nonnegative()).max(50_000),
  })
  .strict()
  .refine((snapshot) => {
    const { headers, rows } = snapshot.dataset
    return (
      new Set(headers).size === headers.length &&
      rows.every((row) => row.length === headers.length) &&
      Object.values(snapshot.mapping).every(
        (column) => column === '' || headers.includes(column),
      ) &&
      Object.keys(snapshot.edits).every(
        (index) => Number(index) < rows.length,
      ) &&
      snapshot.excluded.every((index) => index < rows.length) &&
      new Set(snapshot.excluded).size === snapshot.excluded.length
    )
  }, 'Invalid project snapshot')
const saveProjectSchema = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(80),
    snapshot: snapshotSchema,
  })
  .strict()
  .refine(
    (input) => Boolean(input.id) === Boolean(input.revision),
    'Revision required for updates',
  )
const idSchema = z.string().uuid()
const shopProductSchema = z
  .object({
    id: z.number().int().positive(),
    sku: z.string().max(255),
    type: z.string().max(80),
    regular_price: z.string().max(80),
    manage_stock: z.boolean(),
    stock_quantity: z.number().int().safe().nullable(),
  })
  .strict()
const desiredSchema = z
  .object({
    regular_price: z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .optional(),
    stock_quantity: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
const transferEntrySchema = z
  .object({
    sku: z.string().min(1).max(255),
    before: shopProductSchema,
    desired: desiredSchema,
    status: z.literal('ready'),
    message: z.string().max(500),
  })
  .strict()
const transferEventSchema = z
  .object({
    runId: idSchema,
    itemId: idSchema,
    status: z.enum([
      'sending',
      'success',
      'failed',
      'conflict',
      'cancelled',
      'unknown',
    ]),
    message: z.string().max(1000),
    observed: shopProductSchema.nullable(),
  })
  .strict()

function openDatabase(filename) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(filename)
  try {
    database.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;',
    )
    database.exec('BEGIN IMMEDIATE')
    const version = database.prepare('PRAGMA user_version').get().user_version
    if (version > 3)
      throw new Error(
        'Diese Datenbank wurde mit einer neueren App-Version erstellt.',
      )
    if (version === 0) {
      database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          filename TEXT NOT NULL,
          product_count INTEGER NOT NULL CHECK(product_count > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision > 0),
          snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
        ) STRICT;
        CREATE INDEX projects_updated ON projects(updated_at DESC);
        PRAGMA user_version = 1;`)
    }
    if (version < 2) {
      database.exec(`CREATE TABLE settings (
        key TEXT PRIMARY KEY CHECK(key = 'theme'),
        value TEXT NOT NULL CHECK(value IN ('light', 'dark'))
      ) STRICT;
      INSERT INTO settings VALUES ('theme', 'light');
      PRAGMA user_version = 2;`)
    }
    if (version < 3) {
      database.exec(`CREATE TABLE transfer_runs (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, created_at TEXT NOT NULL,
        finished_at TEXT, status TEXT NOT NULL, items TEXT NOT NULL CHECK(json_valid(items))
      ) STRICT;
      CREATE TABLE transfer_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES transfer_runs(id), item_id TEXT NOT NULL,
        timestamp TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL,
        observed TEXT CHECK(observed IS NULL OR json_valid(observed))
      ) STRICT;
      CREATE INDEX transfer_events_run ON transfer_events(run_id, sequence);
      PRAGMA user_version = 3;`)
    }
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    database.close()
    throw error
  }

  const columns =
    'id, name, filename, product_count AS productCount, created_at AS createdAt, updated_at AS updatedAt, revision'
  const listQuery = database.prepare(
    `SELECT ${columns} FROM projects ORDER BY updated_at DESC, id LIMIT 100`,
  )
  const getQuery = database.prepare(
    `SELECT ${columns}, snapshot FROM projects WHERE id = ?`,
  )
  const insertQuery = database.prepare(
    'INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  )
  const updateQuery = database.prepare(
    'UPDATE projects SET name = ?, filename = ?, product_count = ?, updated_at = ?, revision = revision + 1, snapshot = ? WHERE id = ? AND revision = ?',
  )
  const deleteQuery = database.prepare(
    'DELETE FROM projects WHERE id = ? AND revision = ?',
  )

  function load(id) {
    const row = getQuery.get(idSchema.parse(id))
    if (!row) throw new Error('Das Projekt wurde nicht gefunden.')
    return { ...row, snapshot: snapshotSchema.parse(JSON.parse(row.snapshot)) }
  }

  function transferDetail(id) {
    const row = database
      .prepare(
        'SELECT id, url, created_at AS createdAt, finished_at AS finishedAt, status, items FROM transfer_runs WHERE id = ?',
      )
      .get(idSchema.parse(id))
    if (!row) throw new Error('Ungueltige Verlaufskennung.')
    const events = database
      .prepare(
        'SELECT sequence, item_id AS itemId, timestamp, status, message, observed FROM transfer_events WHERE run_id = ? ORDER BY sequence',
      )
      .all(id)
      .map((event) => ({
        ...event,
        observed: event.observed ? JSON.parse(event.observed) : null,
      }))
    const latest = new Map(events.map((event) => [event.itemId, event]))
    const items = JSON.parse(row.items).map((item) => ({
      ...item,
      status: latest.get(item.id)?.status ?? 'pending',
      message: latest.get(item.id)?.message ?? 'Noch kein Schreibversuch.',
      observed: latest.get(item.id)?.observed ?? null,
    }))
    return { ...row, items, events }
  }

  return {
    startTransfer(payload) {
      const parsed = z
        .object({
          url: z.string().url().max(2048),
          entries: z.array(transferEntrySchema).min(1).max(100),
        })
        .strict()
        .parse(payload)
      const url = new URL(parsed.url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('Ungueltige Shopadresse im Verlauf.')
      const id = randomUUID()
      const items = parsed.entries.map((entry) => ({
        ...entry,
        id: randomUUID(),
      }))
      database
        .prepare('INSERT INTO transfer_runs VALUES (?, ?, ?, NULL, ?, ?)')
        .run(
          id,
          url.toString(),
          new Date().toISOString(),
          'running',
          JSON.stringify(items),
        )
      return transferDetail(id)
    },
    recordTransfer(payload) {
      const parsed = transferEventSchema.parse(payload)
      const run = transferDetail(parsed.runId)
      if (!run.items.some((item) => item.id === parsed.itemId))
        throw new Error('Ungueltige Verlaufskennung.')
      database
        .prepare(
          'INSERT INTO transfer_events (run_id, item_id, timestamp, status, message, observed) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          parsed.runId,
          parsed.itemId,
          new Date().toISOString(),
          parsed.status,
          parsed.message,
          parsed.observed ? JSON.stringify(parsed.observed) : null,
        )
      return true
    },
    finishTransfer(payload) {
      const parsed = z
        .object({
          id: idSchema,
          status: z.enum(['finished', 'cancelled', 'interrupted']),
        })
        .strict()
        .parse(payload)
      database
        .prepare(
          'UPDATE transfer_runs SET status = ?, finished_at = ? WHERE id = ?',
        )
        .run(parsed.status, new Date().toISOString(), parsed.id)
      return true
    },
    transferDetail,
    listTransfers(page = 0) {
      const offset = z.number().int().min(0).max(1_000_000).parse(page) * 20
      const rows = database
        .prepare(
          'SELECT id FROM transfer_runs ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?',
        )
        .all(offset)
      return {
        total: database
          .prepare('SELECT COUNT(*) AS total FROM transfer_runs')
          .get().total,
        runs: rows.map((row) => {
          const run = transferDetail(row.id)
          const counts = {}
          for (const item of run.items)
            counts[item.status] = (counts[item.status] ?? 0) + 1
          return {
            id: run.id,
            url: run.url,
            createdAt: run.createdAt,
            finishedAt: run.finishedAt,
            status: run.status,
            count: run.items.length,
            counts,
          }
        }),
      }
    },
    getTheme: () =>
      database.prepare("SELECT value FROM settings WHERE key = 'theme'").get()
        ?.value ?? 'light',
    setTheme(value) {
      const parsed = z.enum(['light', 'dark']).safeParse(value)
      if (!parsed.success) throw new Error('Ungueltiges Farbschema.')
      database
        .prepare("UPDATE settings SET value = ? WHERE key = 'theme'")
        .run(parsed.data)
      return parsed.data
    },
    list: () => listQuery.all(),
    load,
    save(payload) {
      const parsed = saveProjectSchema.safeParse(payload)
      if (!parsed.success)
        throw new Error('Der Projektstand ist ungueltig oder zu gross.')
      const { id, revision, name, snapshot } = parsed.data
      const serialized = JSON.stringify(snapshot)
      if (Buffer.byteLength(serialized) > 40 * 1024 * 1024)
        throw new Error('Maximal 40 MB pro gespeichertem Projekt.')
      const timestamp = new Date().toISOString()
      const projectId = id ?? randomUUID()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (id) {
          const result = updateQuery.run(
            name,
            snapshot.filename,
            snapshot.dataset.rows.length,
            timestamp,
            serialized,
            id,
            revision,
          )
          if (!result.changes)
            throw new Error(
              'Das Projekt wurde geaendert oder geloescht. Bitte erneut oeffnen oder als neues Projekt speichern.',
            )
        } else {
          if (
            database.prepare('SELECT COUNT(*) AS count FROM projects').get()
              .count >= 100
          )
            throw new Error(
              'Maximal 100 gespeicherte Projekte. Bitte zuerst ein Projekt loeschen.',
            )
          insertQuery.run(
            projectId,
            name,
            snapshot.filename,
            snapshot.dataset.rows.length,
            timestamp,
            timestamp,
            serialized,
          )
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      const { snapshot: _snapshot, ...summary } = load(projectId)
      return summary
    },
    delete(payload) {
      const parsed = z
        .object({ id: idSchema, revision: z.number().int().positive() })
        .strict()
        .safeParse(payload)
      if (!parsed.success) throw new Error('Ungueltige Projektkennung.')
      if (!deleteQuery.run(parsed.data.id, parsed.data.revision).changes)
        throw new Error(
          'Das Projekt wurde geaendert oder geloescht. Bitte Liste aktualisieren.',
        )
      return true
    },
    info: () => ({ path: filename, schemaVersion: 3 }),
    close: () => database.close(),
  }
}

module.exports = { openDatabase, saveProjectSchema }
