const { app, BrowserWindow, Menu, Tray, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { MetArtProvider } = require('./api/met-api');

const CONFIG_PATH = path.join(app.getPath('userData'), 'art-show-config.json');
const artProvider = new MetArtProvider();
const VALID_INTERVALS = [1, 3, 5];

const DEFAULT_CONFIG = {
  interval: 3,
  windowX: undefined,
  windowY: undefined,
  windowWidth: 360,
  windowHeight: 480,
  alwaysOnTop: true,
  customKeywords: [],
};

function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    const cfg = { ...DEFAULT_CONFIG, ...parsed };
    if (!VALID_INTERVALS.includes(cfg.interval)) cfg.interval = 3;
    // Validate customKeywords: must be an array of non-empty trimmed strings
    if (!Array.isArray(cfg.customKeywords)) {
      cfg.customKeywords = [];
    } else {
      cfg.customKeywords = cfg.customKeywords
        .filter(k => typeof k === 'string' && k.trim().length > 0)
        .map(k => k.trim())
        .slice(0, 50);
    }
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

if (Array.isArray(config.customKeywords) && config.customKeywords.length > 0) {
  artProvider.setCustomKeywords(config.customKeywords);
}

function isPointOnAnyDisplay(x, y) {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds;
    if (x >= dx && x < dx + dw && y >= dy && y < dy + dh) {
      return true;
    }
  }
  return false;
}

function clampToDisplay(x, y, w, h) {
  // If the saved center is on any display, use as-is
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (isPointOnAnyDisplay(cx, cy)) {
    return { x, y };
  }
  // Otherwise fall back to primary display top-left
  const primary = screen.getPrimaryDisplay().workArea;
  return { x: primary.x + 40, y: primary.y + 40 };
}

function applyWindowLayering(targetWindow, alwaysOnTop) {
  if (typeof targetWindow.setSkipTaskbar === 'function') {
    targetWindow.setSkipTaskbar(alwaysOnTop);
  }

  if (alwaysOnTop) {
    targetWindow.setAlwaysOnTop(true, 'normal');
    return;
  }

  targetWindow.setAlwaysOnTop(false);
}

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const w = config.windowWidth;
  const h = config.windowHeight;
  const { x, y } = clampToDisplay(config.windowX ?? 40, config.windowY ?? 40, w, h);

  const windowOptions = {
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
    skipTaskbar: config.alwaysOnTop,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (config.alwaysOnTop) {
    windowOptions.alwaysOnTop = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  applyWindowLayering(mainWindow, config.alwaysOnTop);
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
  { label: 'Every 1 min', value: 1 },
  { label: 'Every 3 min', value: 3 },
  { label: 'Every 5 min', value: 5 },
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
    applyWindowLayering(mainWindow, config.alwaysOnTop);
  }
  saveConfig(config);
  return config.alwaysOnTop;
});

ipcMain.handle('set-keywords', (_event, keywords) => {
  const MAX_KEYWORDS = 50;
  const MAX_KEYWORD_LENGTH = 100;
  const cleaned = Array.isArray(keywords)
    ? keywords
        .filter(k => typeof k === 'string' && k.trim().length > 0 && k.trim().length <= MAX_KEYWORD_LENGTH)
        .map(k => k.trim().slice(0, MAX_KEYWORD_LENGTH))
        // Case-insensitive dedup
        .filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i)
        .slice(0, MAX_KEYWORDS)
    : [];
  config.customKeywords = cleaned;
  artProvider.setCustomKeywords(cleaned);
  saveConfig(config);
  return config.customKeywords;
});

ipcMain.handle('prompt-keywords', () => {
  return config.customKeywords;
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
        if (mainWindow) applyWindowLayering(mainWindow, config.alwaysOnTop);
        saveConfig(config);
      },
    },
    {
      label: 'Set Keywords...',
      click: () => mainWindow?.webContents.send('prompt-keywords', config.customKeywords),
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
