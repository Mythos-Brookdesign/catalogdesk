const { DatabaseSync } = require('node:sqlite')
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} = require('node:fs')
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
const databasePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'))
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
const accountFields = {
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(['admin', 'editor', 'reader']),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  passwordHash: z.string().regex(/^[a-f0-9]{128}$/),
}
const bootstrapAccountSchema = z
  .object({ ...accountFields, role: z.literal('admin') })
  .strict()
const createAccountSchema = z.object(accountFields).strict()
const userIdSchema = z.string().uuid()
const transferActorSchema = z.object({ actorId: userIdSchema })

function removeSqliteSidecars(filename) {
  rmSync(`${filename}-wal`, { force: true })
  rmSync(`${filename}-shm`, { force: true })
}

function restoreDatabase(filename, backupFilename) {
  const activePath = path.resolve(databasePathSchema.parse(filename))
  const sourcePath = path.resolve(databasePathSchema.parse(backupFilename))
  if (activePath === sourcePath)
    throw new Error('Sicherungsdatei muss von der aktiven Datenbank abweichen.')

  const stagingPath = `${activePath}.restore-${randomUUID()}`
  const previousPath = `${activePath}.previous-${randomUUID()}`
  let candidate
  let previousMoved = false
  let replacementInstalled = false
  try {
    copyFileSync(sourcePath, stagingPath)
    chmodSync(stagingPath, 0o600)
    candidate = openDatabase(stagingPath)
    if (!candidate.isHealthy())
      throw new Error('Sicherungsdatei ist beschaedigt.')
    candidate.authState()
    candidate.getTheme()
    candidate.list()
    candidate.listTransfers()
    candidate.close()
    candidate = null
    removeSqliteSidecars(stagingPath)

    renameSync(activePath, previousPath)
    previousMoved = true
    renameSync(stagingPath, activePath)
    replacementInstalled = true

    candidate = openDatabase(activePath)
    if (!candidate.isHealthy())
      throw new Error('Wiederhergestellte Datenbank ist beschaedigt.')
    const state = candidate.authState()
    candidate.close()
    candidate = null
    removeSqliteSidecars(activePath)
    rmSync(previousPath, { force: true })
    previousMoved = false
    return state
  } catch (error) {
    candidate?.close()
    if (replacementInstalled) {
      rmSync(activePath, { force: true })
      removeSqliteSidecars(activePath)
    }
    if (previousMoved && existsSync(previousPath))
      renameSync(previousPath, activePath)
    throw error
  } finally {
    rmSync(stagingPath, { force: true })
    removeSqliteSidecars(stagingPath)
  }
}

function openDatabase(filename) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(filename)
  try {
    database.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;',
    )
    database.exec('BEGIN IMMEDIATE')
    const version = database.prepare('PRAGMA user_version').get().user_version
    if (version > 5)
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
    if (version < 4) {
      database.exec(`CREATE TABLE app_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'reader')),
        password_salt TEXT NOT NULL CHECK(length(password_salt) = 32),
        password_hash TEXT NOT NULL CHECK(length(password_hash) = 128),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      ) STRICT;
      CREATE INDEX app_users_active ON app_users(active, username);
      ALTER TABLE transfer_runs ADD COLUMN actor_user_id TEXT REFERENCES app_users(id);
      ALTER TABLE transfer_events ADD COLUMN actor_user_id TEXT REFERENCES app_users(id);
      PRAGMA user_version = 4;`)
    }
    if (version < 5) {
      database.exec(`ALTER TABLE transfer_runs ADD COLUMN actor_username TEXT;
      ALTER TABLE transfer_events ADD COLUMN actor_username TEXT;
      PRAGMA user_version = 5;`)
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
        'SELECT id, url, created_at AS createdAt, finished_at AS finishedAt, status, items, actor_user_id AS actorId, (SELECT username FROM app_users WHERE id = actor_user_id) AS actorUsername FROM transfer_runs WHERE id = ?',
      )
      .get(idSchema.parse(id))
    if (!row) throw new Error('Ungueltige Verlaufskennung.')
    const events = database
      .prepare(
        'SELECT sequence, item_id AS itemId, timestamp, status, message, observed, actor_user_id AS actorId, (SELECT username FROM app_users WHERE id = actor_user_id) AS actorUsername FROM transfer_events WHERE run_id = ? ORDER BY sequence',
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
          actorId: userIdSchema,
          actorUsername: z.string().min(3).max(32),
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
        .prepare(
          'INSERT INTO transfer_runs (id, url, created_at, finished_at, status, items, actor_user_id, actor_username) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
        )
        .run(
          id,
          url.toString(),
          new Date().toISOString(),
          'running',
          JSON.stringify(items),
          parsed.actorId,
          parsed.actorUsername,
        )
      return transferDetail(id)
    },
    recordTransfer(payload) {
      const parsed = transferEventSchema
        .merge(transferActorSchema)
        .extend({ actorUsername: z.string().min(3).max(32) })
        .parse(payload)
      const run = transferDetail(parsed.runId)
      if (!run.items.some((item) => item.id === parsed.itemId))
        throw new Error('Ungueltige Verlaufskennung.')
      database
        .prepare(
          'INSERT INTO transfer_events (run_id, item_id, timestamp, status, message, observed, actor_user_id, actor_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          parsed.runId,
          parsed.itemId,
          new Date().toISOString(),
          parsed.status,
          parsed.message,
          parsed.observed ? JSON.stringify(parsed.observed) : null,
          parsed.actorId,
          parsed.actorUsername,
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
    backupInto(targetFilename) {
      const targetPath = path.resolve(databasePathSchema.parse(targetFilename))
      if (targetPath === path.resolve(filename))
        throw new Error(
          'Sicherungsdatei muss von der aktiven Datenbank abweichen.',
        )
      const stagingPath = `${targetPath}.pending-${randomUUID()}`
      const previousPath = `${targetPath}.previous-${randomUUID()}`
      let previousMoved = false
      try {
        const escapedPath = stagingPath.replaceAll("'", "''")
        database.exec(`VACUUM INTO '${escapedPath}'`)
        chmodSync(stagingPath, 0o600)
        if (existsSync(targetPath)) {
          renameSync(targetPath, previousPath)
          previousMoved = true
        }
        renameSync(stagingPath, targetPath)
        const bytes = statSync(targetPath).size
        if (previousMoved) rmSync(previousPath, { force: true })
        previousMoved = false
        return { bytes }
      } catch (error) {
        if (previousMoved && existsSync(previousPath))
          renameSync(previousPath, targetPath)
        throw error
      } finally {
        rmSync(stagingPath, { force: true })
        removeSqliteSidecars(stagingPath)
      }
    },
    isHealthy: () =>
      database.prepare('PRAGMA integrity_check').get().integrity_check ===
        'ok' && database.prepare('PRAGMA foreign_key_check').all().length === 0,
    authState: () => ({
      setupRequired:
        database.prepare('SELECT COUNT(*) AS count FROM app_users').get()
          .count === 0,
    }),
    findUser(username) {
      const parsed = z.string().trim().min(3).max(32).parse(username)
      return (
        database
          .prepare(
            'SELECT id, username, display_name AS displayName, role, password_salt AS salt, password_hash AS passwordHash, active, last_login_at AS lastLoginAt FROM app_users WHERE username = ? COLLATE NOCASE',
          )
          .get(parsed) ?? null
      )
    },
    createInitialAdmin(payload) {
      const parsed = bootstrapAccountSchema.parse(payload)
      database.exec('BEGIN IMMEDIATE')
      try {
        if (
          database.prepare('SELECT COUNT(*) AS count FROM app_users').get()
            .count !== 0
        )
          throw new Error('Ein Administratorkonto ist bereits eingerichtet.')
        const id = randomUUID()
        const timestamp = new Date().toISOString()
        database
          .prepare(
            'INSERT INTO app_users (id, username, display_name, role, password_salt, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          )
          .run(
            id,
            parsed.username,
            parsed.displayName,
            parsed.role,
            parsed.salt,
            parsed.passwordHash,
            timestamp,
            timestamp,
          )
        database.exec('COMMIT')
        return {
          id,
          username: parsed.username,
          displayName: parsed.displayName,
          role: parsed.role,
        }
      } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK')
        throw error
      }
    },
    createUser(payload) {
      const parsed = createAccountSchema.parse(payload)
      const id = randomUUID()
      const timestamp = new Date().toISOString()
      database
        .prepare(
          'INSERT INTO app_users (id, username, display_name, role, password_salt, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(
          id,
          parsed.username,
          parsed.displayName,
          parsed.role,
          parsed.salt,
          parsed.passwordHash,
          timestamp,
          timestamp,
        )
      return {
        id,
        username: parsed.username,
        displayName: parsed.displayName,
        role: parsed.role,
        active: true,
        createdAt: timestamp,
        lastLoginAt: null,
      }
    },
    listUsers: () =>
      database
        .prepare(
          'SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt, last_login_at AS lastLoginAt FROM app_users ORDER BY username LIMIT 200',
        )
        .all()
        .map((user) => ({ ...user, active: Boolean(user.active) })),
    setUserActive(payload) {
      const parsed = z
        .object({ id: userIdSchema, active: z.boolean() })
        .strict()
        .parse(payload)
      const user = database
        .prepare('SELECT role, active FROM app_users WHERE id = ?')
        .get(parsed.id)
      if (!user) throw new Error('Benutzer wurde nicht gefunden.')
      if (
        !parsed.active &&
        user.active &&
        user.role === 'admin' &&
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND active = 1",
          )
          .get().count <= 1
      )
        throw new Error(
          'Der letzte aktive Administrator kann nicht deaktiviert werden.',
        )
      database
        .prepare('UPDATE app_users SET active = ?, updated_at = ? WHERE id = ?')
        .run(Number(parsed.active), new Date().toISOString(), parsed.id)
      return true
    },
    recordLogin(id) {
      database
        .prepare(
          'UPDATE app_users SET last_login_at = ?, updated_at = ? WHERE id = ? AND active = 1',
        )
        .run(
          new Date().toISOString(),
          new Date().toISOString(),
          userIdSchema.parse(id),
        )
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
    info: () => ({ path: filename, schemaVersion: 5 }),
    close: () => database.close(),
  }
}

module.exports = { openDatabase, restoreDatabase, saveProjectSchema }
