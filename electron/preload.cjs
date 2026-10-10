const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('catalogDesktop', {
  openCsv: () => ipcRenderer.invoke('catalog:open-csv'),
  saveCsv: (payload) => ipcRenderer.invoke('catalog:save-csv', payload),
  testShopConnection: (payload) =>
    ipcRenderer.invoke('catalog:test-shop', payload),
})
