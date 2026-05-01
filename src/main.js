const { app, BrowserWindow, Menu, Tray, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { MetArtProvider } = require('./api/met-api');

const CONFIG_PATH = path.join(app.getPath('userData'), 'art-show-config.json');
const artProvider = new MetArtProvider();
const VALID_INTERVALS = [5, 10, 15, 30];

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
    const parsed = JSON.parse(data);
    const cfg = { ...DEFAULT_CONFIG, ...parsed };
    if (!VALID_INTERVALS.includes(cfg.interval)) cfg.interval = 10;
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

let saveTimer = null;
function saveConfig(config) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch {}
  }, 500);
}

let mainWindow = null;
let tray = null;
let config = loadConfig();

function clampToDisplay(x, y, w, h) {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
    if (x + w > dx && x < dx + dw && y + h > dy && y < dy + dh) {
      return {
        x: Math.max(dx, Math.min(x, dx + dw - w)),
        y: Math.max(dy, Math.min(y, dy + dh - h)),
      };
    }
  }
  const primary = screen.getPrimaryDisplay().workArea;
  return { x: Math.min(x, primary.x + primary.width - w), y: Math.min(y, primary.y + primary.height - h) };
}

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const w = config.windowWidth;
  const h = config.windowHeight;
  const { x, y } = clampToDisplay(config.windowX ?? 40, config.windowY ?? 40, w, h);

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
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
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Block navigation away from local files
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
    return await artProvider.getNext();
  } catch {
    return null;
  }
});

ipcMain.handle('set-interval', (_event, minutes) => {
  const valid = VALID_INTERVALS.includes(minutes) ? minutes : 10;
  config.interval = valid;
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
