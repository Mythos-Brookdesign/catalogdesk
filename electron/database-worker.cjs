const { parentPort, workerData } = require('node:worker_threads')
const { openDatabase } = require('./database.cjs')

let database
let startupError
try {
  database = openDatabase(workerData.filename)
} catch {
  startupError =
    'Die lokale Datenbank konnte nicht geoeffnet werden. Speicherplatz, Zugriffsrechte und App-Version pruefen.'
}

const operations = new Set([
  'list',
  'load',
  'save',
  'delete',
  'info',
  'close',
  'getTheme',
  'setTheme',
])
parentPort.on('message', ({ id, operation, payload }) => {
  try {
    if (operation === 'close' && startupError) {
      parentPort.postMessage({ id, result: null })
      parentPort.close()
      return
    }
    if (startupError) throw new Error(startupError)
    if (!operations.has(operation))
      throw new Error('Unbekannte Datenbankoperation.')
    const result = database[operation](payload)
    parentPort.postMessage({ id, result })
    if (operation === 'close') parentPort.close()
  } catch (error) {
    const safe = [
      'Die lokale Datenbank',
      'Das Projekt wurde',
      'Der Projektstand ist',
      'Maximal ',
      'Ungueltige Projektkennung.',
      'Ungueltiges Farbschema.',
      'Unbekannte Datenbankoperation.',
    ].some((prefix) => error.message?.startsWith(prefix))
    parentPort.postMessage({
      id,
      error: safe
        ? error.message
        : 'Datenbankoperation fehlgeschlagen. Bitte Speicherplatz und Zugriffsrechte pruefen.',
    })
    if (operation === 'close') parentPort.close()
  }
})
