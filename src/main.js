const { app, BrowserWindow, Menu, Tray, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { MetArtProvider } = require('./api/met-api');

const CONFIG_PATH = path.join(app.getPath('userData'), 'art-show-config.json');
const artProvider = new MetArtProvider();
const DEFAULT_CONFIG = {
  interval: 10,
  windowX: undefined,
  windowY: undefined,
  windowWidth: 360,
  windowHeight: 480,
  alwaysOnTop: true,
};

function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {}
}

let mainWindow = null;
let tray = null;
let config = loadConfig();

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const x = config.windowX ?? 40;
  const y = config.windowY ?? 40;

  mainWindow = new BrowserWindow({
    width: config.windowWidth,
    height: config.windowHeight,
    minWidth: 240,
    minHeight: 320,
    maxWidth: 600,
    maxHeight: 800,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    config.windowWidth = w;
    config.windowHeight = h;
    saveConfig(config);
  });

  mainWindow.on('move', () => {
    const [x, y] = mainWindow.getPosition();
    config.windowX = x;
    config.windowY = y;
    saveConfig(config);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'renderer', 'tray-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Art Show');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

const intervalOptions = [
  { label: 'Every 5 min', value: 5 },
  { label: 'Every 10 min', value: 10 },
  { label: 'Every 15 min', value: 15 },
  { label: 'Every 30 min', value: 30 },
];

ipcMain.handle('get-config', () => config);

ipcMain.handle('get-next-artwork', async () => {
  try {
    const artwork = await artProvider.getNext();
    return artwork;
  } catch (err) {
    return null;
  }
});

ipcMain.handle('set-interval', (_event, minutes) => {
  config.interval = minutes;
  saveConfig(config);
  return config;
});

ipcMain.handle('toggle-always-on-top', () => {
  config.alwaysOnTop = !config.alwaysOnTop;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  }
  saveConfig(config);
  return config.alwaysOnTop;
});

ipcMain.handle('show-context-menu', () => {
  const menu = Menu.buildFromTemplate([
    { label: 'Next Artwork', click: () => mainWindow?.webContents.send('next-artwork') },
    { type: 'separator' },
    ...intervalOptions.map(opt => ({
      label: opt.label,
      type: 'radio',
      checked: config.interval === opt.value,
      click: () => {
        config.interval = opt.value;
        saveConfig(config);
        mainWindow?.webContents.send('config-changed', config);
      },
    })),
    { type: 'separator' },
    {
      label: config.alwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top',
      click: () => {
        config.alwaysOnTop = !config.alwaysOnTop;
        if (mainWindow) mainWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating');
        saveConfig(config);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  menu.popup({ window: mainWindow });
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
