const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  safeStorage,
} = require('electron')
const { readFile, writeFile, stat } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { assetPath, saveSchema, trustedSender } = require('./security.cjs')
const { testConnection } = require('./shop.cjs')
const { importShopProducts } = require('./shop-import.cjs')
const { discoverShopRest } = require('./shop-discovery.cjs')
const { createDatabaseClient } = require('./database-client.cjs')
const { createShopStore } = require('./shop-store.cjs')
const { createAuthenticator } = require('./auth.cjs')
const {
  previewTransfer,
  executeTransfer,
  verifyTransfer,
} = require('./shop-transfer.cjs')

const development = !app.isPackaged && process.argv.includes('--dev')
const entryUrl = development
  ? 'http://127.0.0.1:5178/'
  : 'catalog://app/index.html'
let mainWindow
let projectDatabase
let authenticator
let initialTheme = 'light'
let transferController = null
let transferPromise = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'catalog',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])
app.setName('CatalogDesk')
if (!app.isPackaged && process.env.CATALOGDESK_TEST_USER_DATA) {
  const { mkdirSync } = require('node:fs')
  mkdirSync(process.env.CATALOGDESK_TEST_USER_DATA, { recursive: true })
  app.setPath('userData', process.env.CATALOGDESK_TEST_USER_DATA)
}

function validateSender(event) {
  if (!trustedSender(event, mainWindow, entryUrl))
    throw new Error('Untrusted IPC sender')
}

function authorize(event, envelope, permission) {
  validateSender(event)
  try {
    return {
      user: authenticator.requireSession(envelope?.sessionToken, permission),
      payload: envelope?.payload,
    }
  } catch (error) {
    if (error.message.startsWith('Sitzung abgelaufen')) {
      try {
        event.sender.send('catalog:auth-expired')
      } catch {}
    }
    throw error
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 820,
    minHeight: 640,
    title: 'CatalogDesk',
    backgroundColor: initialTheme === 'dark' ? '#181c1a' : '#f7f8fa',
    show: false,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  )
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
  mainWindow.loadURL(entryUrl)
}

app.whenReady().then(async () => {
  const shopStore = createShopStore(
    path.join(app.getPath('userData'), 'credentials'),
    safeStorage,
  )
  for (const operation of ['summary', 'save', 'delete']) {
    ipcMain.handle(
      `catalog:shop-store-${operation}`,
      async (event, envelope) => {
        try {
          const permission =
            operation === 'summary' ? 'catalog:read' : 'shop:manage'
          const { payload } = authorize(event, envelope, permission)
          return { ok: true, value: await shopStore[operation](payload) }
        } catch (error) {
          return { ok: false, error: error.message }
        }
      },
    )
  }
  async function shopCredentials(payload) {
    if (payload !== null) return payload
    const saved = await shopStore.load()
    if (!saved) throw new Error('Keine gespeicherte Shopverbindung vorhanden.')
    return saved
  }
  async function rememberExplicitShopCredentials(payload, connection, result) {
    if (!result.ok || payload === null)
      return { ...result, credentialsSaved: true }
    try {
      await shopStore.save(connection)
      return { ...result, credentialsSaved: true }
    } catch (error) {
      return { ...result, credentialsSaved: false, storageError: error.message }
    }
  }
  projectDatabase = createDatabaseClient(
    path.join(app.getPath('userData'), 'data', 'catalogdesk.sqlite'),
  )
  authenticator = createAuthenticator((operation, payload) =>
    projectDatabase.request(operation, payload),
  )
  ipcMain.handle('catalog:auth-state', async (event, token) => {
    validateSender(event)
    return authenticator.status(token)
  })
  ipcMain.handle('catalog:auth-bootstrap', async (event, payload) => {
    validateSender(event)
    try {
      return { ok: true, ...(await authenticator.bootstrap(payload)) }
    } catch {
      return {
        ok: false,
        error:
          'Ersteinrichtung fehlgeschlagen. Benutzername und sicheres Passwort pruefen.',
      }
    }
  })
  ipcMain.handle('catalog:auth-login', async (event, payload) => {
    validateSender(event)
    try {
      return { ok: true, ...(await authenticator.login(payload)) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('catalog:auth-logout', async (event, token) => {
    validateSender(event)
    return authenticator.logout(token)
  })
  ipcMain.handle('catalog:users-list', async (event, envelope) => {
    try {
      authorize(event, envelope, 'users:manage')
      return {
        ok: true,
        value: await authenticator.listUsers(envelope.sessionToken),
      }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('catalog:users-create', async (event, envelope) => {
    try {
      authorize(event, envelope, 'users:manage')
      return {
        ok: true,
        value: await authenticator.createUser(
          envelope.sessionToken,
          envelope.payload,
        ),
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error.message.startsWith('Sitzung') ||
          error.message.startsWith('Fuer ')
            ? error.message
            : 'Benutzer konnte nicht angelegt werden. Benutzername eventuell bereits vergeben.',
      }
    }
  })
  ipcMain.handle('catalog:users-set-active', async (event, envelope) => {
    try {
      authorize(event, envelope, 'users:manage')
      return {
        ok: true,
        value: await authenticator.setUserActive(
          envelope.sessionToken,
          envelope.payload,
        ),
      }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('catalog:get-theme', async (event) => {
    validateSender(event)
    try {
      return { ok: true, value: await projectDatabase.request('getTheme') }
    } catch {
      return { ok: false, error: 'Farbschema konnte nicht geladen werden.' }
    }
  })
  ipcMain.handle('catalog:set-theme', async (event, envelope) => {
    try {
      authorize(event, envelope, 'theme:write')
    } catch (error) {
      return { ok: false, error: error.message }
    }
    try {
      const value = await projectDatabase.request('setTheme', envelope.payload)
      initialTheme = value
      mainWindow?.setBackgroundColor(value === 'dark' ? '#181c1a' : '#f7f8fa')
      return { ok: true, value }
    } catch {
      return { ok: false, error: 'Farbschema konnte nicht gespeichert werden.' }
    }
  })
  for (const operation of ['list', 'load', 'save', 'delete', 'info']) {
    ipcMain.handle(`catalog:projects-${operation}`, async (event, envelope) => {
      try {
        const permission = ['save', 'delete'].includes(operation)
          ? 'projects:write'
          : 'projects:read'
        const { payload } = authorize(event, envelope, permission)
        return {
          ok: true,
          value: await projectDatabase.request(operation, payload),
        }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    })
  }
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  if (!development) {
    protocol.handle('catalog', (request) => {
      try {
        if (request.method !== 'GET')
          return new Response('Method not allowed', { status: 405 })
        return net.fetch(
          pathToFileURL(
            assetPath(request.url, path.join(__dirname, '../dist')),
          ).toString(),
        )
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
  }
  ipcMain.handle('catalog:open-csv', async (event, envelope) => {
    authorize(event, envelope, 'files:read')
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Produktdatei oeffnen',
      properties: ['openFile'],
      filters: [{ name: 'CSV-Dateien', extensions: ['csv', 'tsv'] }],
    })
    if (canceled || !filePaths[0]) return null
    const info = await stat(filePaths[0])
    if (!info.isFile() || info.size > 10 * 1024 * 1024)
      throw new Error('Maximal 10 MB pro CSV-Datei.')
    return {
      name: path.basename(filePaths[0]),
      content: await readFile(filePaths[0], 'utf8'),
    }
  })
  ipcMain.handle('catalog:save-csv', async (event, envelope) => {
    const { payload } = authorize(event, envelope, 'files:write')
    const { filename, content } = saveSchema.parse(payload)
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'CSV speichern',
      defaultPath: filename,
      filters: [{ name: 'CSV-Datei', extensions: ['csv'] }],
    })
    if (canceled || !filePath) return false
    await writeFile(filePath, content, 'utf8')
    return true
  })
  let connectionTestRunning = false
  let shopImportController = null
  let transferPlan = null
  function transferBusy() {
    return Boolean(transferController)
  }
  function databaseBusy() {
    return connectionTestRunning || shopImportController || transferBusy()
  }
  ipcMain.handle('catalog:database-backup', async (event, envelope) => {
    try {
      authorize(event, envelope, 'database:manage')
      if (databaseBusy())
        return {
          ok: false,
          error: 'Bitte zuerst laufende Shopvorgaenge beenden.',
        }
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'CatalogDesk-Datenbank sichern',
        defaultPath: `CatalogDesk-Sicherung-${new Date().toISOString().slice(0, 10)}.sqlite`,
        filters: [{ name: 'CatalogDesk-Sicherung', extensions: ['sqlite'] }],
      })
      if (canceled || !filePath) return { ok: true, value: null }
      return {
        ok: true,
        value: await projectDatabase.request('backupInto', filePath),
      }
    } catch {
      return {
        ok: false,
        error: 'Datenbanksicherung konnte nicht erstellt werden.',
      }
    }
  })
  ipcMain.handle('catalog:database-restore', async (event, envelope) => {
    try {
      authorize(event, envelope, 'database:manage')
      if (databaseBusy())
        return {
          ok: false,
          error: 'Bitte zuerst laufende Shopvorgaenge beenden.',
        }
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'CatalogDesk-Sicherung wiederherstellen',
        properties: ['openFile'],
        filters: [
          { name: 'CatalogDesk-Sicherung', extensions: ['sqlite', 'db'] },
        ],
      })
      if (canceled || !filePaths[0]) return { ok: true, value: null }
      const value = await projectDatabase.request(
        'restoreDatabase',
        filePaths[0],
      )
      authenticator = createAuthenticator((operation, payload) =>
        projectDatabase.request(operation, payload),
      )
      initialTheme = await projectDatabase.request('getTheme')
      mainWindow?.setBackgroundColor(
        initialTheme === 'dark' ? '#181c1a' : '#f7f8fa',
      )
      event.sender.send('catalog:auth-expired')
      return { ok: true, value }
    } catch {
      return {
        ok: false,
        error:
          'Sicherung konnte nicht wiederhergestellt werden. Die aktive Datenbank blieb unveraendert.',
      }
    }
  })
  ipcMain.handle('catalog:preview-transfer', async (event, payload) => {
    let requestPayload
    try {
      requestPayload = authorize(event, payload, 'transfer:preview').payload
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    transferPlan = null
    const controller = new AbortController()
    transferController = controller
    try {
      const connection = await shopCredentials(null)
      transferPromise = previewTransfer(
        connection,
        requestPayload,
        (url, options) => net.fetch(url, options),
        controller.signal,
      )
      const plan = await transferPromise
      transferPlan = { plan, expires: Date.now() + 10 * 60_000 }
      return { ok: true, value: plan }
    } catch {
      return {
        ok: false,
        error:
          'Vorschau konnte nicht geladen werden. Gespeicherte Shopverbindung, Leserechte und Auswahl pruefen (maximal 100 Produkte).',
      }
    } finally {
      transferController = null
      transferPromise = null
    }
  })
  ipcMain.handle('catalog:execute-transfer', async (event, payload) => {
    validateSender(event)
    let actor
    let requestPayload
    try {
      const authorized = authorize(event, payload, 'transfer:execute')
      actor = authorized.user
      requestPayload = authorized.payload
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    if (
      !transferPlan ||
      !requestPayload ||
      requestPayload.confirmed !== true ||
      requestPayload.planId !== transferPlan.plan.id ||
      Date.now() > transferPlan.expires
    )
      return {
        ok: false,
        error:
          'Freigabe fehlt oder Vorschau ist abgelaufen. Bitte Vorschau erneut laden.',
      }
    const cached = transferPlan.plan
    transferPlan = null
    const controller = new AbortController()
    transferController = controller
    try {
      const connection = await shopCredentials(null)
      transferPromise = executeTransfer(
        connection,
        cached,
        requestPayload.selected,
        (url, options) => net.fetch(url, options),
        (operation, input) =>
          projectDatabase.request(
            operation,
            ['startTransfer', 'recordTransfer'].includes(operation)
              ? { ...input, actorId: actor.id, actorUsername: actor.username }
              : input,
          ),
        { signal: controller.signal },
      )
      return { ok: true, value: await transferPromise }
    } catch {
      return {
        ok: false,
        error:
          'Uebertragung nicht vollstaendig abgeschlossen. Shopverbindung und Historie pruefen; unklare Schreibversuche nicht blind wiederholen.',
      }
    } finally {
      transferController = null
      transferPromise = null
    }
  })
  ipcMain.handle('catalog:cancel-transfer', (event, envelope) => {
    authorize(event, envelope, 'transfer:execute')
    transferController?.abort()
  })
  for (const [channel, operation] of [
    ['list-history', 'listTransfers'],
    ['history-detail', 'transferDetail'],
  ]) {
    ipcMain.handle(`catalog:${channel}`, async (event, payload) => {
      try {
        authorize(event, payload, 'history:read')
      } catch (error) {
        return { ok: false, error: error.message }
      }
      try {
        const requestPayload = payload.payload
        return {
          ok: true,
          value: await projectDatabase.request(operation, requestPayload),
        }
      } catch {
        return { ok: false, error: 'Historie konnte nicht geladen werden.' }
      }
    })
  }
  ipcMain.handle('catalog:verify-history', async (event, id) => {
    let actor
    let requestId
    try {
      const authorized = authorize(event, id, 'history:verify')
      actor = authorized.user
      requestId = authorized.payload
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    const controller = new AbortController()
    transferController = controller
    try {
      const connection = await shopCredentials(null)
      const run = await projectDatabase.request('transferDetail', requestId)
      transferPromise = verifyTransfer(
        connection,
        run,
        (url, options) => net.fetch(url, options),
        (operation, input) =>
          projectDatabase.request(
            operation,
            ['recordTransfer'].includes(operation)
              ? { ...input, actorId: actor.id, actorUsername: actor.username }
              : input,
          ),
      )
      return { ok: true, value: await transferPromise }
    } catch {
      return {
        ok: false,
        error:
          'Nachpruefung fehlgeschlagen. Gespeicherte Verbindung muss zum Shop des Verlaufs passen.',
      }
    } finally {
      transferController = null
      transferPromise = null
    }
  })
  ipcMain.handle('catalog:test-shop', async (event, payload) => {
    try {
      authorize(event, payload, 'shop:read')
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Ein Verbindungstest laeuft bereits.' }
    connectionTestRunning = true
    try {
      const connection = await shopCredentials(payload.payload)
      const result = await testConnection(connection, (url, options) =>
        net.fetch(url, options),
      )
      return await rememberExplicitShopCredentials(
        payload.payload,
        connection,
        result,
      )
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      connectionTestRunning = false
    }
  })
  ipcMain.handle('catalog:discover-shop-rest', async (event, envelope) => {
    try {
      authorize(event, envelope, 'shop:read')
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    connectionTestRunning = true
    try {
      const connection = await shopCredentials(envelope.payload)
      return await discoverShopRest(connection, (url, options) =>
        net.fetch(url, options),
      )
    } catch {
      return {
        ok: false,
        error:
          'REST-API konnte nicht untersucht werden. Shopverbindung pruefen.',
      }
    } finally {
      connectionTestRunning = false
    }
  })
  ipcMain.handle('catalog:import-shop', async (event, payload) => {
    try {
      authorize(event, payload, ['shop:read', 'shop:import', 'catalog:write'])
    } catch (error) {
      return { ok: false, error: error.message }
    }
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    const controller = new AbortController()
    shopImportController = controller
    try {
      const connection = await shopCredentials(payload.payload)
      const result = await importShopProducts(
        connection,
        (url, options) => net.fetch(url, options),
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (event.sender.isDestroyed()) {
              controller.abort()
              return
            }
            event.sender.send('catalog:import-shop-progress', progress)
          },
        },
      )
      return await rememberExplicitShopCredentials(
        payload.payload,
        connection,
        result,
      )
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      shopImportController = null
    }
  })
  ipcMain.handle('catalog:cancel-shop-import', (event, envelope) => {
    authorize(event, envelope, ['shop:read', 'shop:import', 'catalog:write'])
    shopImportController?.abort()
  })
  app.on('before-quit', () => shopImportController?.abort())
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'Ansicht',
        submenu: [
          { role: 'reload' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          ...(development ? [{ role: 'toggleDevTools' }] : []),
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
  try {
    initialTheme = await projectDatabase.request('getTheme')
  } catch {
    initialTheme = 'light'
  }
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
let databaseClosed = false
let databaseClosing = false
app.on('before-quit', (event) => {
  if (!projectDatabase || databaseClosed) return
  event.preventDefault()
  if (databaseClosing) return
  databaseClosing = true
  transferController?.abort()
  Promise.resolve(transferPromise)
    .catch(() => {})
    .then(() => projectDatabase.close())
    .catch(() => {})
    .finally(() => {
      databaseClosed = true
      app.quit()
    })
})
