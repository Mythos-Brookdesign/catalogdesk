import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import client from './database-client.cjs'

it('opens SQLite in a background thread and safely reports startup failures', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'catalogdesk-worker-'))
  let database
  try {
    database = client.createDatabaseClient(
      path.join(directory, 'data', 'catalogdesk.sqlite'),
    )
    expect(await database.request('list')).toEqual([])
    expect(await database.request('info')).toMatchObject({ schemaVersion: 5 })
    expect(await database.request('getTheme')).toBe('light')
    expect(await database.request('setTheme', 'dark')).toBe('dark')
    await expect(
      database.request('exec', 'DROP TABLE projects'),
    ).rejects.toThrow('Unbekannte')
    await database.close()
    database = client.createDatabaseClient(directory)
    await expect(database.request('list')).rejects.toThrow('nicht geoeffnet')
  } finally {
    await database?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
