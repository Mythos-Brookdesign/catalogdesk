const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('catalogDesktop', {
  getTheme: () => ipcRenderer.invoke('catalog:get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('catalog:set-theme', theme),
  savedShopConnection: () => ipcRenderer.invoke('catalog:shop-store-summary'),
  saveShopConnection: (payload) =>
    ipcRenderer.invoke('catalog:shop-store-save', payload),
  deleteShopConnection: () => ipcRenderer.invoke('catalog:shop-store-delete'),
  listProjects: () => ipcRenderer.invoke('catalog:projects-list'),
  loadProject: (id) => ipcRenderer.invoke('catalog:projects-load', id),
  saveProject: (payload) =>
    ipcRenderer.invoke('catalog:projects-save', payload),
  deleteProject: (payload) =>
    ipcRenderer.invoke('catalog:projects-delete', payload),
  databaseInfo: () => ipcRenderer.invoke('catalog:projects-info'),
  openCsv: () => ipcRenderer.invoke('catalog:open-csv'),
  saveCsv: (payload) => ipcRenderer.invoke('catalog:save-csv', payload),
  testShopConnection: (payload) =>
    ipcRenderer.invoke('catalog:test-shop', payload),
  importShopProducts: (payload) =>
    ipcRenderer.invoke('catalog:import-shop', payload),
  cancelShopImport: () => ipcRenderer.invoke('catalog:cancel-shop-import'),
  onShopImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('catalog:import-shop-progress', listener)
    return () =>
      ipcRenderer.removeListener('catalog:import-shop-progress', listener)
  },
})
