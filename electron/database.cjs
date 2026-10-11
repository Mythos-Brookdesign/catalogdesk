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

function openDatabase(filename) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(filename)
  try {
    database.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;',
    )
    database.exec('BEGIN IMMEDIATE')
    const version = database.prepare('PRAGMA user_version').get().user_version
    if (version > 2)
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

  return {
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
    info: () => ({ path: filename, schemaVersion: 2 }),
    close: () => database.close(),
  }
}

module.exports = { openDatabase, saveProjectSchema }
