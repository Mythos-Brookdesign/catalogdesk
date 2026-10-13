import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import storage from './database.cjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})
const location = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'catalogdesk-db-'))
  directories.push(directory)
  return path.join(directory, 'data', 'catalogdesk.sqlite')
}
const snapshot = {
  filename: 'supplier.csv',
  demo: false,
  dataset: {
    headers: ['SKU', 'Name', 'Price'],
    rows: [
      ['001', 'Notebook', '12,50'],
      ['002', 'Pen', '3,00'],
    ],
    delimiter: ',',
  },
  mapping: {
    sku: 'SKU',
    name: 'Name',
    price: 'Price',
    stock: '',
    category: '',
    description: '',
  },
  options: { trim: true, normalizePrices: true, priceFormat: 'de' },
  edits: { 0: { price: '11,50' } },
  excluded: [1],
}

describe('local SQLite projects', () => {
  it('keeps an immutable transfer event history across reopening and migration from version 2', () => {
    const filename = location()
    let database = storage.openDatabase(filename)
    const saved = database.save({ name: 'Keep', snapshot })
    database.setTheme('dark')
    database.close()
    const old = new DatabaseSync(filename)
    old.exec(
      'DROP TABLE shop_catalog_products; DROP TABLE shop_catalog_imports; DROP TABLE transfer_events; DROP TABLE transfer_runs; DROP TABLE app_users; PRAGMA user_version = 2',
    )
    old.close()
    database = storage.openDatabase(filename)
    const before = {
      id: 1,
      sku: 'A',
      type: 'simple',
      regular_price: '10.00',
      stock_quantity: 2,
      manage_stock: true,
    }
    const actor = database.createInitialAdmin({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      salt: '0'.repeat(32),
      passwordHash: '1'.repeat(128),
    })
    const run = database.startTransfer({
      url: 'https://example.com/',
      actorId: actor.id,
      actorUsername: actor.username,
      entries: [
        {
          sku: 'A',
          before,
          desired: { regular_price: '12.50' },
          status: 'ready',
          message: 'Freigegeben',
        },
      ],
    })
    database.recordTransfer({
      runId: run.id,
      itemId: run.items[0].id,
      status: 'sending',
      actorId: actor.id,
      actorUsername: actor.username,
      message: 'Schreibversuch',
      observed: before,
    })
    database.recordTransfer({
      runId: run.id,
      itemId: run.items[0].id,
      status: 'unknown',
      actorId: actor.id,
      actorUsername: actor.username,
      message: 'Unklar',
      observed: null,
    })
    database.finishTransfer({ id: run.id, status: 'interrupted' })
    database.close()
    database = storage.openDatabase(filename)
    try {
      expect(database.transferDetail(run.id).events).toHaveLength(2)
      expect(database.transferDetail(run.id).actorUsername).toBe('admin')
      expect(database.transferDetail(run.id).events[0].actorUsername).toBe(
        'admin',
      )
      expect(database.transferDetail(run.id).items[0]).toMatchObject({
        status: 'unknown',
        before,
        desired: { regular_price: '12.50' },
      })
      expect(database.listTransfers().runs[0].counts).toEqual({ unknown: 1 })
      expect(database.getTheme()).toBe('dark')
      expect(database.load(saved.id).name).toBe('Keep')
    } finally {
      database.close()
    }
  })
  it('migrates version 1 without losing projects and persists both themes', () => {
    const filename = location()
    let database = storage.openDatabase(filename)
    const saved = database.save({ name: 'Existing import', snapshot })
    database.close()
    const old = new DatabaseSync(filename)
    old.exec(
      'DROP TABLE shop_catalog_products; DROP TABLE shop_catalog_imports; DROP TABLE transfer_events; DROP TABLE transfer_runs; DROP TABLE app_users; DROP TABLE settings; PRAGMA user_version = 1',
    )
    old.close()
    database = storage.openDatabase(filename)
    expect(database.getTheme()).toBe('light')
    expect(database.load(saved.id).snapshot).toEqual(snapshot)
    expect(database.setTheme('dark')).toBe('dark')
    expect(() => database.setTheme("dark'); DROP TABLE projects;--")).toThrow(
      'Farbschema',
    )
    database.close()
    database = storage.openDatabase(filename)
    expect(database.getTheme()).toBe('dark')
    database.setTheme('light')
    database.close()
    database = storage.openDatabase(filename)
    try {
      expect(database.getTheme()).toBe('light')
      expect(database.load(saved.id).name).toBe('Existing import')
    } finally {
      database.close()
    }
  })
  it('creates a real SQLite database and restores snapshots after reopening', () => {
    const filename = location()
    let database = storage.openDatabase(filename)
    expect(database.list()).toEqual([])
    const saved = database.save({ name: 'Lieferant', snapshot })
    expect(saved).toMatchObject({
      name: 'Lieferant',
      productCount: 2,
      revision: 1,
    })
    database.close()
    expect(readFileSync(filename).subarray(0, 16).toString()).toBe(
      'SQLite format 3\0',
    )
    database = storage.openDatabase(filename)
    try {
      expect(database.load(saved.id).snapshot).toEqual(snapshot)
      expect(database.list()).toHaveLength(1)
    } finally {
      database.close()
    }
  })
  it('stores shop product JSON and parent-variant relationships across reopening', () => {
    const filename = location()
    let database = storage.openDatabase(filename)
    const actor = database.createInitialAdmin({
      username: 'catalog-admin',
      displayName: 'Catalog Admin',
      role: 'admin',
      salt: '0'.repeat(32),
      passwordHash: '1'.repeat(128),
    })
    const importedAt = new Date().toISOString()
    const products = [
      {
        id: 101,
        parentId: null,
        type: 'variable',
        sku: 'shirt',
        name: 'Shirt',
        payload: {
          id: 101,
          type: 'variable',
          attributes: [{ name: 'Groesse', options: ['M', 'L'] }],
        },
      },
      {
        id: 102,
        parentId: 101,
        type: 'variation',
        sku: 'shirt-m',
        name: 'Shirt M',
        payload: {
          id: 102,
          parent_id: 101,
          attributes: [{ name: 'Groesse', option: 'M' }],
          germanized: { unit: 'Stueck' },
        },
      },
      {
        id: 103,
        parentId: null,
        type: 'simple',
        sku: 'mug-1',
        name: 'Tasse',
        payload: {
          id: 103,
          type: 'simple',
          sku: 'mug-1',
          name: 'Tasse',
          regular_price: '15.90',
          manage_stock: true,
          stock_quantity: 3,
          categories: [{ id: 2, name: 'Papeterie, Buero' }],
          description: 'Keramiktasse',
        },
      },
    ]
    const input = {
      url: 'https://catalogdesk.local/shop/',
      importedAt,
      actorId: actor.id,
      actorUsername: actor.username,
      products,
    }
    expect(database.replaceShopCatalog(input)).toMatchObject({
      productCount: 3,
      importedBy: 'catalog-admin',
    })
    expect(database.shopCatalogInfo(input.url)).toMatchObject({
      productCount: 3,
      importedAt,
    })
    expect(
      database.listShopCatalogProducts({
        url: input.url,
        page: 0,
        pageSize: 1,
      }),
    ).toMatchObject({
      total: 3,
      page: 0,
      pageSize: 1,
      products: [products[0]],
    })
    expect(() =>
      database.replaceShopCatalog({
        ...input,
        products: [products[0], products[0]],
      }),
    ).toThrow('doppelte')
    expect(
      database.listShopCatalogProducts({
        url: input.url,
        page: 0,
        pageSize: 100,
      }).products,
    ).toEqual(products)
    database.close()

    database = storage.openDatabase(filename)
    try {
      expect(
        database.listShopCatalogProducts({ url: input.url }).products,
      ).toEqual(products)
      expect(database.loadLatestShopCatalog()).toMatchObject({
        url: input.url,
        importedBy: 'catalog-admin',
        total: 3,
        imported: 1,
        skipped: [
          { type: 'variable', count: 1 },
          { type: 'variation', count: 1 },
        ],
        dataset: {
          rows: [
            [
              'mug-1',
              'Tasse',
              '15.90',
              '3',
              'Papeterie\\, Buero',
              'Keramiktasse',
            ],
          ],
        },
      })
      expect(database.info().schemaVersion).toBe(6)
    } finally {
      database.close()
    }
  })
  it('creates a private consistent backup and restores it without retaining later changes', () => {
    const filename = location()
    const backupFilename = path.join(
      path.dirname(filename),
      'catalogdesk-backup.sqlite',
    )
    let database = storage.openDatabase(filename)
    database.setTheme('dark')
    database.save({ name: 'Before backup', snapshot })
    expect(database.backupInto(backupFilename).bytes).toBeGreaterThan(0)
    database.save({ name: 'After backup', snapshot })
    expect(database.backupInto(backupFilename).bytes).toBeGreaterThan(0)
    database.save({ name: 'After replacement', snapshot })
    database.close()

    expect(storage.restoreDatabase(filename, backupFilename)).toEqual({
      setupRequired: true,
    })
    database = storage.openDatabase(filename)
    try {
      expect(database.isHealthy()).toBe(true)
      expect(database.getTheme()).toBe('dark')
      expect(
        database
          .list()
          .map((project) => project.name)
          .sort(),
      ).toEqual(['After backup', 'Before backup'])
    } finally {
      database.close()
    }
  })
  it('keeps the active database intact when a selected backup is invalid', () => {
    const filename = location()
    const invalidBackup = path.join(path.dirname(filename), 'invalid.sqlite')
    let database = storage.openDatabase(filename)
    database.save({ name: 'Keep active data', snapshot })
    database.close()
    writeFileSync(invalidBackup, 'not a SQLite database')

    expect(() => storage.restoreDatabase(filename, invalidBackup)).toThrow()
    database = storage.openDatabase(filename)
    try {
      expect(database.list().map((project) => project.name)).toEqual([
        'Keep active data',
      ])
    } finally {
      database.close()
    }
  })
  it('updates atomically, rejects stale revisions, and deletes explicitly', () => {
    const database = storage.openDatabase(location())
    try {
      const first = database.save({
        name: "Supplier'); DROP TABLE projects;--",
        snapshot,
      })
      const updated = database.save({
        id: first.id,
        revision: 1,
        name: 'Updated',
        snapshot: { ...snapshot, excluded: [] },
      })
      expect(updated.revision).toBe(2)
      expect(() =>
        database.save({ id: first.id, revision: 1, name: 'Stale', snapshot }),
      ).toThrow('geaendert')
      expect(database.load(first.id).name).toBe('Updated')
      expect(() => database.delete({ id: first.id, revision: 1 })).toThrow()
      expect(database.delete({ id: first.id, revision: 2 })).toBe(true)
      expect(database.list()).toEqual([])
      expect(() => database.load(first.id)).toThrow()
    } finally {
      database.close()
    }
  })
  it('rejects invalid snapshots, unexpected secret fields and SQL identifiers', () => {
    const database = storage.openDatabase(location())
    try {
      for (const invalid of [
        { ...snapshot, consumerSecret: 'not-for-storage' },
        { ...snapshot, excluded: [4] },
        { ...snapshot, edits: { 10: { name: 'bad' } } },
        { ...snapshot, dataset: { ...snapshot.dataset, rows: [['bad']] } },
      ])
        expect(() =>
          database.save({ name: 'Invalid', snapshot: invalid }),
        ).toThrow()
      expect(() => database.load("' OR 1=1 --")).toThrow()
      expect(database.list()).toEqual([])
    } finally {
      database.close()
    }
  })
  it('refuses a newer schema without replacing the existing file', () => {
    const filename = location()
    storage.openDatabase(filename).close()
    const database = new DatabaseSync(filename)
    database.exec('PRAGMA user_version = 7')
    database.close()
    expect(() => storage.openDatabase(filename)).toThrow('neueren')
    const check = new DatabaseSync(filename)
    expect(check.prepare('PRAGMA user_version').get().user_version).toBe(7)
    check.close()
  })
})
