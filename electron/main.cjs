const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
} = require('electron')
const { readFile, writeFile, stat } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { assetPath, saveSchema, trustedSender } = require('./security.cjs')

const development = !app.isPackaged && process.argv.includes('--dev')
const entryUrl = development
  ? 'http://127.0.0.1:5178/'
  : 'catalog://app/index.html'
let mainWindow

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
