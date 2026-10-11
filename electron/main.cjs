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

const development = !app.isPackaged && process.argv.includes('--dev')
const entryUrl = development
  ? 'http://127.0.0.1:5178/'
  : 'catalog://app/index.html'
let mainWindow
let projectDatabase

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
    backgroundColor: '#f7f8fa',
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

app.whenReady().then(() => {
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
  ipcMain.handle('catalog:test-shop', async (event, payload) => {
    validateSender(event)
    if (connectionTestRunning || shopImportController)
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
    if (connectionTestRunning || shopImportController)
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
  projectDatabase
    .close()
    .catch(() => {})
    .finally(() => {
      databaseClosed = true
      app.quit()
    })
})
