const { contextBridge, ipcRenderer } = require('electron')

let sessionToken = null
const authListeners = new Set()

ipcRenderer.on('catalog:auth-expired', () => {
  sessionToken = null
  for (const listener of authListeners) listener()
})

const authorized = (channel, payload) =>
  ipcRenderer.invoke(channel, { sessionToken, payload })

contextBridge.exposeInMainWorld('catalogDesktop', {
  authState: async () => ipcRenderer.invoke('catalog:auth-state', sessionToken),
  bootstrapAdmin: async (payload) => {
    const result = await ipcRenderer.invoke('catalog:auth-bootstrap', payload)
    if (result.ok) sessionToken = result.sessionToken
    return result.ok ? { ok: true, user: result.user } : result
  },
  login: async (payload) => {
    const result = await ipcRenderer.invoke('catalog:auth-login', payload)
    if (result.ok) sessionToken = result.sessionToken
    return result.ok ? { ok: true, user: result.user } : result
  },
  logout: async () => {
    const token = sessionToken
    sessionToken = null
    if (!token) return true
    return ipcRenderer.invoke('catalog:auth-logout', token)
  },
  onAuthExpired: (callback) => {
    authListeners.add(callback)
    return () => authListeners.delete(callback)
  },
  listUsers: () => authorized('catalog:users-list'),
  createUser: (payload) => authorized('catalog:users-create', payload),
  setUserActive: (payload) => authorized('catalog:users-set-active', payload),
  previewTransfer: (payload) => authorized('catalog:preview-transfer', payload),
  executeTransfer: (payload) => authorized('catalog:execute-transfer', payload),
  cancelTransfer: () => authorized('catalog:cancel-transfer'),
  listHistory: (page) => authorized('catalog:list-history', page),
  historyDetail: (id) => authorized('catalog:history-detail', id),
  verifyHistory: (id) => authorized('catalog:verify-history', id),
  getTheme: () => ipcRenderer.invoke('catalog:get-theme'),
  setTheme: (theme) => authorized('catalog:set-theme', theme),
  savedShopConnection: () => authorized('catalog:shop-store-summary'),
  saveShopConnection: (payload) =>
    authorized('catalog:shop-store-save', payload),
  deleteShopConnection: () => authorized('catalog:shop-store-delete'),
  listProjects: () => authorized('catalog:projects-list'),
  loadProject: (id) => authorized('catalog:projects-load', id),
  saveProject: (payload) => authorized('catalog:projects-save', payload),
  deleteProject: (payload) => authorized('catalog:projects-delete', payload),
  databaseInfo: () => authorized('catalog:projects-info'),
  backupDatabase: () => authorized('catalog:database-backup'),
  restoreDatabase: () => authorized('catalog:database-restore'),
  openCsv: () => authorized('catalog:open-csv'),
  saveCsv: (payload) => authorized('catalog:save-csv', payload),
  testShopConnection: (payload) => authorized('catalog:test-shop', payload),
  importShopProducts: (payload) => authorized('catalog:import-shop', payload),
  cancelShopImport: () => authorized('catalog:cancel-shop-import'),
  onShopImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('catalog:import-shop-progress', listener)
    return () =>
      ipcRenderer.removeListener('catalog:import-shop-progress', listener)
  },
})
