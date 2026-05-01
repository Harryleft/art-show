const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artShow', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getNextArtwork: () => ipcRenderer.invoke('get-next-artwork'),
  setInterval: (minutes) => ipcRenderer.invoke('set-interval', minutes),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  onNextArtwork: (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on('next-artwork', listener);
    return () => ipcRenderer.removeListener('next-artwork', listener);
  },
  onConfigChanged: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on('config-changed', listener);
    return () => ipcRenderer.removeListener('config-changed', listener);
  },
});
