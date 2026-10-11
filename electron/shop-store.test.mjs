import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import storage from './shop-store.cjs'

const connection = {
  url: 'https://catalogdesk.local',
  consumerKey: 'ck_' + 'a'.repeat(40),
  consumerSecret: 'cs_' + 'b'.repeat(40),
}
function encryption() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decryptString(buffer) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        buffer.subarray(0, 12),
      )
      decipher.setAuthTag(buffer.subarray(12, 28))
      return Buffer.concat([
        decipher.update(buffer.subarray(28)),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}

it('persists encrypted credentials and only exposes the URL as metadata', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-secrets-'),
  )
  try {
    const provider = encryption()
    let store = storage.createShopStore(directory, provider)
    expect(await store.summary()).toBeNull()
    expect(await store.save(connection)).toEqual({
      url: 'https://catalogdesk.local/',
    })
    const raw = await readFile(path.join(directory, 'shop-connection.enc'))
    expect(raw.includes(Buffer.from(connection.consumerSecret))).toBe(false)
    expect(raw.includes(Buffer.from(connection.consumerKey))).toBe(false)
    store = storage.createShopStore(directory, provider)
    expect(await store.load()).toEqual({
      ...connection,
      url: 'https://catalogdesk.local/',
    })
    expect(await store.summary()).toEqual({ url: 'https://catalogdesk.local/' })
    await store.delete()
    expect(await store.load()).toBeNull()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('fails closed for insecure providers and corrupted files without leaking secrets', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'catalogdesk-secrets-'),
  )
  try {
    const provider = encryption()
    for (const insecure of [
      { ...provider, isEncryptionAvailable: () => false },
      { ...provider, getSelectedStorageBackend: () => 'basic_text' },
    ]) {
      await expect(
        storage.createShopStore(directory, insecure, 'linux').save(connection),
      ).rejects.toThrow('Kein sicherer')
    }
    const store = storage.createShopStore(directory, provider)
    await expect(
      store.save({ ...connection, url: 'http://catalogdesk.local' }),
    ).rejects.toThrow('Ungueltige')
    await writeFile(
      path.join(directory, 'shop-connection.enc'),
      connection.consumerSecret,
    )
    await expect(store.load()).rejects.toThrow('entschluesselt')
    await store.delete()
    expect(await store.summary()).toBeNull()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
