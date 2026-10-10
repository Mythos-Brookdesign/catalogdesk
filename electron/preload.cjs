const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('catalogDesktop', {
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
})
