import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    database.exec('PRAGMA user_version = 2')
    database.close()
    expect(() => storage.openDatabase(filename)).toThrow('neueren')
    const check = new DatabaseSync(filename)
    expect(check.prepare('PRAGMA user_version').get().user_version).toBe(2)
    check.close()
  })
})
