const { readFile, writeFile, mkdir, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { connectionSchema } = require('./shop.cjs')

function createShopStore(directory, encryption, platform = process.platform) {
  const filename = path.join(directory, 'shop-connection.enc')
  let queue = Promise.resolve()
  function secure() {
    const linuxBackends = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']
    if (
      !encryption.isEncryptionAvailable() ||
      (platform === 'linux' &&
        !linuxBackends.includes(encryption.getSelectedStorageBackend()))
    ) {
      throw new Error(
        'Kein sicherer Systemspeicher verfuegbar. Die Verbindung wird nicht dauerhaft gespeichert.',
      )
    }
  }
  function serial(action) {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  async function load() {
    let buffer
    try {
      buffer = await readFile(filename)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error(
        'Gespeicherte Shopverbindung konnte nicht gelesen werden.',
      )
    }
    secure()
    try {
      if (buffer.length > 16 * 1024) throw new Error('Invalid storage')
      return connectionSchema.parse(
        JSON.parse(encryption.decryptString(buffer)),
      )
    } catch {
      throw new Error(
        'Gespeicherte Shopverbindung konnte nicht entschluesselt werden. Bitte loeschen und erneut speichern.',
      )
    }
  }
  return {
    load: () => serial(load),
    summary: () =>
      serial(async () => {
        const saved = await load()
        return saved ? { url: saved.url } : null
      }),
    save: (payload) =>
      serial(async () => {
        const parsed = connectionSchema.safeParse(payload)
        if (!parsed.success)
          throw new Error(
            'Ungueltige Shopverbindung. HTTPS-Adresse und Schluessel pruefen.',
          )
        secure()
        const url = new URL(parsed.data.url)
        url.pathname = url.pathname.replace(/\/+$/, '') + '/'
        const connection = { ...parsed.data, url: url.toString() }
        const temporary = `${filename}.tmp`
        try {
          const encrypted = encryption.encryptString(JSON.stringify(connection))
          await mkdir(directory, { recursive: true, mode: 0o700 })
          await writeFile(temporary, encrypted, { mode: 0o600 })
          await rename(temporary, filename)
        } catch {
          await rm(temporary, { force: true }).catch(() => {})
          throw new Error(
            'Shopverbindung konnte nicht sicher gespeichert werden. Systemspeicher und Zugriffsrechte pruefen.',
          )
        }
        return { url: connection.url }
      }),
    delete: () =>
      serial(async () => {
        try {
          await rm(filename, { force: true })
          return true
        } catch {
          throw new Error(
            'Gespeicherte Shopverbindung konnte nicht geloescht werden.',
          )
        }
      }),
  }
}

module.exports = { createShopStore }
