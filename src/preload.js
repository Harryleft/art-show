const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artShow', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getNextArtwork: () => ipcRenderer.invoke('get-next-artwork'),
  setInterval: (minutes) => ipcRenderer.invoke('set-interval', minutes),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  setKeywords: (keywords) => ipcRenderer.invoke('set-keywords', keywords),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  adjustWindowSize: (width, height) => ipcRenderer.invoke('adjust-window-size', width, height),
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
  onPromptKeywords: (callback) => {
    const listener = (_event, keywords) => callback(keywords);
    ipcRenderer.on('prompt-keywords', listener);
    return () => ipcRenderer.removeListener('prompt-keywords', listener);
  },
});
