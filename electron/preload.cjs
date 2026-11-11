const { contextBridge, ipcRenderer } = require('electron')
const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke('studio:' + channel, ...args)
const listen = (channel) => (callback) => {
  const listener = (_event, data) => callback(data)
  ipcRenderer.on('studio:' + channel, listener)
  return () => ipcRenderer.removeListener('studio:' + channel, listener)
}
contextBridge.exposeInMainWorld('studio', {
  initialize: invoke('initialize'),
  personalSeed: invoke('personalSeed'),
  list: invoke('list'),
  save: invoke('save'),
  remove: invoke('remove'),
  backup: invoke('backup'),
  restore: invoke('restore'),
  exportPDF: invoke('exportPDF'),
  openOutput: invoke('openOutput'),
  revealOutput: invoke('revealOutput'),
  importFile: invoke('importFile'),
  cancelImport: invoke('cancelImport'),
  onImportProgress: listen('importProgress'),
  onBeforeClose: listen('beforeClose'),
  closeReady: invoke('closeReady'),
})
