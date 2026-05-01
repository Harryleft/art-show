const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artShow', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getNextArtwork: () => ipcRenderer.invoke('get-next-artwork'),
  setInterval: (minutes) => ipcRenderer.invoke('set-interval', minutes),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  onNextArtwork: (callback) => ipcRenderer.on('next-artwork', callback),
  onConfigChanged: (callback) => ipcRenderer.on('config-changed', (_event, config) => callback(config)),
});
