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
const { createDatabaseClient } = require('./database-client.cjs')
const { createShopStore } = require('./shop-store.cjs')
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
      async (event, payload) => {
        validateSender(event)
        try {
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
  projectDatabase = createDatabaseClient(
    path.join(app.getPath('userData'), 'data', 'catalogdesk.sqlite'),
  )
  ipcMain.handle('catalog:get-theme', async (event) => {
    validateSender(event)
    try {
      return { ok: true, value: await projectDatabase.request('getTheme') }
    } catch {
      return { ok: false, error: 'Farbschema konnte nicht geladen werden.' }
    }
  })
  ipcMain.handle('catalog:set-theme', async (event, theme) => {
    validateSender(event)
    try {
      const value = await projectDatabase.request('setTheme', theme)
      initialTheme = value
      mainWindow?.setBackgroundColor(value === 'dark' ? '#181c1a' : '#f7f8fa')
      return { ok: true, value }
    } catch {
      return { ok: false, error: 'Farbschema konnte nicht gespeichert werden.' }
    }
  })
  for (const operation of ['list', 'load', 'save', 'delete', 'info']) {
    ipcMain.handle(`catalog:projects-${operation}`, async (event, payload) => {
      validateSender(event)
      try {
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
  ipcMain.handle('catalog:open-csv', async (event) => {
    validateSender(event)
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
  ipcMain.handle('catalog:save-csv', async (event, payload) => {
    validateSender(event)
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
  ipcMain.handle('catalog:preview-transfer', async (event, payload) => {
    validateSender(event)
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    transferPlan = null
    const controller = new AbortController()
    transferController = controller
    try {
      const connection = await shopCredentials(null)
      transferPromise = previewTransfer(
        connection,
        payload,
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
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    if (
      !transferPlan ||
      !payload ||
      payload.confirmed !== true ||
      payload.planId !== transferPlan.plan.id ||
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
        payload.selected,
        (url, options) => net.fetch(url, options),
        (operation, input) => projectDatabase.request(operation, input),
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
  ipcMain.handle('catalog:cancel-transfer', (event) => {
    validateSender(event)
    transferController?.abort()
  })
  for (const [channel, operation] of [
    ['list-history', 'listTransfers'],
    ['history-detail', 'transferDetail'],
  ]) {
    ipcMain.handle(`catalog:${channel}`, async (event, payload) => {
      validateSender(event)
      try {
        return {
          ok: true,
          value: await projectDatabase.request(operation, payload),
        }
      } catch {
        return { ok: false, error: 'Historie konnte nicht geladen werden.' }
      }
    })
  }
  ipcMain.handle('catalog:verify-history', async (event, id) => {
    validateSender(event)
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    const controller = new AbortController()
    transferController = controller
    try {
      const connection = await shopCredentials(null)
      const run = await projectDatabase.request('transferDetail', id)
      transferPromise = verifyTransfer(
        connection,
        run,
        (url, options) => net.fetch(url, options),
        (operation, input) => projectDatabase.request(operation, input),
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
    validateSender(event)
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Ein Verbindungstest laeuft bereits.' }
    connectionTestRunning = true
    try {
      return await testConnection(
        await shopCredentials(payload),
        (url, options) => net.fetch(url, options),
      )
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      connectionTestRunning = false
    }
  })
  ipcMain.handle('catalog:import-shop', async (event, payload) => {
    validateSender(event)
    if (connectionTestRunning || shopImportController || transferBusy())
      return { ok: false, error: 'Eine Shopanfrage laeuft bereits.' }
    const controller = new AbortController()
    shopImportController = controller
    try {
      return await importShopProducts(
        await shopCredentials(payload),
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
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      shopImportController = null
    }
  })
  ipcMain.handle('catalog:cancel-shop-import', (event) => {
    validateSender(event)
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
