const { Worker } = require('node:worker_threads')
const path = require('node:path')

function createDatabaseClient(filename) {
  const worker = new Worker(path.join(__dirname, 'database-worker.cjs'), {
    workerData: { filename },
  })
  const pending = new Map()
  let sequence = 0
  let stopped = false
  let closing = false
  function fail() {
    stopped = true
    for (const request of pending.values())
      request.reject(
        new Error(
          'Die Datenbankverbindung wurde unterbrochen. Bitte die App neu starten.',
        ),
      )
    pending.clear()
  }
  worker.on('error', fail)
  worker.on('exit', fail)
  worker.on('message', ({ id, result, error }) => {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(result)
  })
  function request(operation, payload) {
    if (stopped || closing)
      return Promise.reject(
        new Error('Die Datenbankverbindung ist geschlossen.'),
      )
    const id = ++sequence
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, operation, payload })
    })
  }
  return {
    request,
    async close() {
      if (stopped || closing) return
      const completion = request('close')
      closing = true
      try {
        await completion
      } finally {
        await worker.terminate()
      }
    },
  }
}

module.exports = { createDatabaseClient }
