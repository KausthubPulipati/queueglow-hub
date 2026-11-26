const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  clipboard,
  dialog,
  shell,
  Notification,
  globalShortcut,
  safeStorage,
  desktopCapturer,
  powerMonitor,
  Tray,
  Menu,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const { HubStore } = require('./store.cjs');
const hooks = require('./hooks.cjs');
const { MediaBridge } = require('./media.cjs');
const { MailBridge } = require('./mail.cjs');
const { discoverCli, chooseProvider, askCli, clipAnswer } = require('./robo-cli.cjs');
const { DURATION_MS, IDLE_SECONDS, gaze } = require('./island-motion.cjs');
const { wallpaperAccent } = require('./wallpaper.cjs');

if (process.env.QUEUEGLOW_SOFTWARE_RENDER === '1') app.disableHardwareAcceleration();

const root =
  process.env.QUEUEGLOW_HOME ||
  path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Queueglow');
const ipcRoot = path.join(root, 'ipc');

function removeLegacyGmailSession() {
  const file = path.join(root, 'gmail-session.bin');
  let token = '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const session = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      token = String(session.refresh_token || session.access_token || '');
    }
  } catch {}
  try {
    fs.rmSync(file, { force: true });
  } catch {}
  if (token) {
    void fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
}

let store,
  win,
  settingsWin,
  tray,
  mediaBridge,
  mailBridge,
  folded = true,
  targetFolded = true,
  motion = 'idle',
  lastClip = '',
  pending = new Map(),
  audio = [];
let hoverArmed = false,
  outsideSince = 0,
  quitting = false;
let motionTimer = null,
  presenceTimer = null,
  lastPresence = '',
  lastPresenceAt = 0;
let lastCursorPoint = null,
  lastCursorMovementAt = Date.now();
let shapedNotch = false;
let activeGlobalHotkey = null;
let roboBusy = false;
let updateState = { supported: false, status: 'idle', version: app.getVersion() };
let wallpaperColor = null;
let cliPaths;
let cliCheckedAt = 0;
const MAX_EVENT = 64000;
const EXPANDED = { width: 660, height: 300, zoom: 0.64 };
const FOLDED = { width: 108, height: 36 };
const ISLAND_SCALE = { compact: 0.9, standard: 1, large: 1.12 };
const SETTINGS_SECTIONS = new Set([
  'home',
  'connections',
  'ai',
  'apps',
  'robo',
  'general',
  'notifications',
  'island',
  'focus',
]);

function islandSize(size = EXPANDED) {
  const scale = ISLAND_SCALE[store.setting('islandSize')];
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

function resetIslandBounds() {
  if (!win || win.isDestroyed()) return;
  const size = islandSize();
  win.setBounds(bounds(size.width, size.height));
  win.webContents.setZoomFactor(EXPANDED.zoom * ISLAND_SCALE[store.setting('islandSize')]);
}

function islandInput(fold) {
  const clickableNotch = fold && store.setting('islandExpansion') === 'click';
  if (clickableNotch && ['win32', 'linux'].includes(process.platform)) {
    const area = win.getBounds();
    const zoom = win.webContents.getZoomFactor();
    const width = Math.round(FOLDED.width * zoom);
    win.setShape([
      {
        x: Math.floor((area.width - width) / 2),
        y: 0,
        width,
        height: Math.ceil(FOLDED.height * zoom),
      },
    ]);
    shapedNotch = true;
  } else if (shapedNotch) {
    win.setShape([]);
    shapedNotch = false;
  }
  const ignore = fold && !clickableNotch;
  win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
}

function bounds(width, height) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const offset = store?.setting('islandStyle') === 'floating' ? 14 : 0;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + offset,
    width,
    height,
  };
}
function emit(extra = {}) {
  if (win && !win.isDestroyed())
    win.webContents.send('update', {
      ...store.state(),
      pending: [...pending.values()],
      audio,
      systemMedia: mediaBridge?.media || null,
      volume: mediaBridge?.volume ?? null,
      system: mediaBridge?.system || null,
      wallpaperColor: store.setting('wallpaperSync') ? wallpaperColor : null,
      roboCapabilities: roboCapabilities(),
      mail: mailBridge?.state() || null,
      folded,
      motion,
      ...extra,
    });
}
function emitMotion() {
  if (win && !win.isDestroyed()) win.webContents.send('motion', { folded, motion });
}
function current() {
  return {
    ...store.state(),
    pending: [...pending.values()],
    audio,
    systemMedia: mediaBridge?.media || null,
    volume: mediaBridge?.volume ?? null,
    system: mediaBridge?.system || null,
    wallpaperColor: store.setting('wallpaperSync') ? wallpaperColor : null,
    roboCapabilities: roboCapabilities(),
    mail: mailBridge?.state() || null,
    folded,
    motion,
  };
}
function resize(fold, snap = false) {
  if (!win || win.isDestroyed()) return null;
  if (!snap && targetFolded === fold)
    return {
      folded: fold,
      ...islandSize(fold ? FOLDED : EXPANDED),
    };
  if (motionTimer) {
    clearTimeout(motionTimer);
    motionTimer = null;
  }
  targetFolded = fold;
  const size = islandSize(fold ? FOLDED : EXPANDED);
  const reduced = store?.setting('reduceMotion');
  motion = snap || reduced ? 'idle' : fold ? 'folding' : 'expanding';
  if (!fold) folded = false;
  if (fold) {
    hoverArmed = false;
    outsideSince = 0;
  } else {
    hoverArmed = pointerInside();
    outsideSince = 0;
  }
  if (motion === 'idle') {
    folded = fold;
    islandInput(fold);
    emitMotion();
  } else {
    if (!fold) {
      islandInput(false);
    }
    emitMotion();
    motionTimer = setTimeout(
      () => {
        motionTimer = null;
        if (!win || win.isDestroyed()) return;
        if (fold) {
          islandInput(true);
        }
        folded = fold;
        motion = 'idle';
        emitMotion();
      },
      store?.setting('animationSpeed') === 'fast' ? 460 : DURATION_MS,
    );
  }
  return { folded: fold, width: size.width, height: size.height };
}
function pointerInsideNotch(point) {
  const rect = win.getBounds();
  const notch = islandSize(FOLDED);
  return (
    point.x >= rect.x + (rect.width - notch.width) / 2 &&
    point.x < rect.x + (rect.width + notch.width) / 2 &&
    point.y >= rect.y &&
    point.y < rect.y + notch.height
  );
}
function pointerInside() {
  const point = screen.getCursorScreenPoint();
  const rect = win.getBounds();
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}
function checkPointerExit() {
  if (!win || win.isDestroyed() || motion !== 'idle') return;
  if (targetFolded) {
    if (
      store.setting('islandExpansion') === 'hover' &&
      pointerInsideNotch(screen.getCursorScreenPoint())
    )
      resize(false);
    return;
  }
  if (pointerInside()) {
    hoverArmed = true;
    outsideSince = 0;
    return;
  }
  if (!hoverArmed) return;
  if (!outsideSince) outsideSince = Date.now();
  else if (Date.now() - outsideSince > 650) resize(true);
}
function pollPresence() {
  if (!win || win.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  if (!lastCursorPoint || point.x !== lastCursorPoint.x || point.y !== lastCursorPoint.y) {
    lastCursorPoint = point;
    lastCursorMovementAt = Date.now();
  }
  const configuredIdle = store.setting('roboSleepAfter');
  const idleSeconds =
    configuredIdle === 'never' ? Infinity : Number(configuredIdle) || IDLE_SECONDS;
  const sleeping =
    powerMonitor.getSystemIdleTime() >= idleSeconds &&
    Date.now() - lastCursorMovementAt >= idleSeconds * 1000;
  const presence = store.setting('roboEyeTracking')
    ? gaze(point, win.getBounds(), sleeping)
    : { x: 0, y: 0, sleeping };
  const key = JSON.stringify(presence);
  if (key !== lastPresence || Date.now() - lastPresenceAt > 500) {
    win.webContents.send('presence', presence);
    lastPresence = key;
    lastPresenceAt = Date.now();
  }
}

function updatePresenceTimer() {
  clearInterval(presenceTimer);
  const cadence =
    { automatic: 100, light: 250, smooth: 65, max: 33 }[store.setting('performanceMode')] || 100;
  presenceTimer = setInterval(pollPresence, cadence);
}

function agentNotification(event) {
  const preference = {
    permission: 'notifyApprovals',
    done: 'notifyCompletion',
    error: 'notifyErrors',
  }[event.kind];
  if (
    !preference ||
    !Notification.isSupported() ||
    !store.setting('notifications') ||
    !store.setting(preference)
  )
    return;
  if (event.kind !== 'permission' && store.setting('focusGuard') && store.hasActiveFocus()) return;
  const provider = event.provider === 'claude' ? 'Claude Code' : 'Codex';
  const title =
    event.kind === 'permission'
      ? provider + ' needs your decision'
      : event.kind === 'done'
        ? provider + ' finished a turn'
        : provider + ' needs attention';
  const showSummary = store.setting('notificationPresentation') === 'summary';
  new Notification({
    title,
    body: showSummary ? event.summary : '',
    silent: !store.setting('sound'),
  }).show();
}

function pollEvents() {
  const inbox = path.join(ipcRoot, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(path.join(ipcRoot, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(ipcRoot, 'heartbeat'), String(Date.now()));
  let changed = false;
  for (const name of fs
    .readdirSync(inbox)
    .filter((n) => /^[a-f0-9-]{36}\.json$/i.test(n))
    .slice(0, 50)) {
    const file = path.join(inbox, name);
    try {
      if (fs.statSync(file).size > MAX_EVENT) continue;
      const event = JSON.parse(fs.readFileSync(file, 'utf8'));
      store.addAgentEvent(event);
      changed = true;
      if (event.kind === 'permission' && Number(event.expires_at) > Date.now() / 1000) {
        pending.set(event.id, {
          id: event.id,
          provider: event.provider,
          summary: String(event.summary || '').slice(0, 180),
          detail: String(event.detail || '').slice(0, 4000),
          expires_at: Number(event.expires_at),
        });
        agentNotification(event);
      }
      if (event.kind === 'done' || event.kind === 'error') agentNotification(event);
    } catch (error) {
      console.error('Agent event:', error.message);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  for (const [id, item] of pending)
    if (item.expires_at <= Date.now() / 1000) {
      pending.delete(id);
      changed = true;
    }
  if (changed) {
    emit();
    emitSettingsActivity();
  }
}
function openWindow() {
  const size = islandSize();
  win = new BrowserWindow({
    ...bounds(size.width, size.height),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      zoomMode: 'isolated',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      resize(true);
      win.hide();
    }
  });
  resetIslandBounds();
  islandInput(true);
  win.setMenuBarVisibility(false);
  win.webContents.on('did-finish-load', () => {
    lastPresence = '';
    pollPresence();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const reposition = () => {
    resetIslandBounds();
    if (folded) islandInput(true);
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-removed', reposition);
}
function openTray() {
  const icon = path.join(__dirname, '..', 'assets', 'tray.png');
  tray = new Tray(icon);
  tray.setToolTip('Queueglow Hub');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Queueglow',
        click: () => {
          win.show();
          resize(false);
        },
      },
      { label: 'Fold to eyes', click: () => resize(true) },
      { label: 'Settings', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: 'Quit Queueglow', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => {
    win.show();
    resize(false);
  });
}

function hookScript() {
  const packaged = path.join(process.resourcesPath, 'agent_hook.ps1');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, 'agent_hook.ps1');
}

function settingsActivity(state) {
  return {
    events: state.events.slice(0, 6).map(({ id, kind, provider, summary, occurred_at }) => ({
      id,
      kind,
      provider,
      summary,
      occurred_at,
    })),
    jobs: state.jobs.length,
    decisions: pending.size,
    focus: state.focus,
  };
}

function emitSettingsActivity() {
  if (settingsWin && !settingsWin.isDestroyed())
    settingsWin.webContents.send('settings:activity', settingsActivity(store.state()));
}

function currentSettings() {
  const state = store.state();
  const connections = Object.fromEntries(
    ['codex', 'claude'].map((provider) => {
      try {
        return [provider, hooks.registrationStatus(provider, hookScript())];
      } catch {
        return [provider, 'unavailable'];
      }
    }),
  );
  const robo = roboProviders(true);
  return {
    settings: state.settings,
    version: app.getVersion(),
    apps: state.apps,
    activity: settingsActivity(state),
    connections,
    notificationsAvailable: Notification.isSupported(),
    canLaunchOnLogin: app.isPackaged && process.platform === 'win32',
    launchOnLogin:
      app.isPackaged && process.platform === 'win32' && app.getLoginItemSettings().openAtLogin,
    robo: {
      provider: robo.provider,
      codex: !!robo.cli.codex,
      claude: !!robo.cli.claude,
      openai: robo.hasKey,
    },
  };
}

function openSettingsWindow(section = 'home') {
  if (!SETTINGS_SECTIONS.has(section)) throw new Error('Invalid settings section');
  if (settingsWin && !settingsWin.isDestroyed()) {
    const activate = () => {
      if (!settingsWin || settingsWin.isDestroyed()) return;
      settingsWin.webContents.send('settings:navigate', section);
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.show();
      settingsWin.focus();
    };
    if (settingsWin.webContents.isLoadingMainFrame()) {
      settingsWin.webContents.once('did-finish-load', activate);
    } else {
      activate();
    }
    return true;
  }
  const next = new BrowserWindow({
    title: 'Queueglow Settings',
    width: 1120,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: '#111a20',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: ['--queueglow-settings'],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin = next;
  next.setMenuBarVisibility(false);
  next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  next.webContents.on('will-navigate', (event) => event.preventDefault());
  next.on('closed', () => {
    settingsWin = null;
  });
  next.once('ready-to-show', () => next.show());
  next
    .loadFile(path.join(__dirname, '..', 'dist', 'settings.html'), { query: { section } })
    .catch((error) => {
      console.error('Settings window:', error.message);
      if (!next.isDestroyed()) next.close();
    });
  return true;
}

function setHubSetting(key, value) {
  if (key === 'globalHotkey') {
    const previousHotkey = store.setting(key);
    const allowed = ['Control+Alt+Q', 'Control+Alt+Space', 'Control+Shift+Q', 'disabled'];
    if (!allowed.includes(value))
      throw new Error('Choose one of the available Queueglow shortcuts');
    registerGlobalHotkey(value);
    try {
      store.setSetting(key, value);
    } catch (error) {
      registerGlobalHotkey(previousHotkey);
      throw error;
    }
    emit();
    return;
  }
  store.setSetting(key, value);
  if (key === 'islandSkin') {
    store.setSetting('wallpaperSync', value === 'wallpaper');
    wallpaperColor = null;
    if (value === 'wallpaper') refreshWallpaperColor();
  }
  if (key === 'clipboardEnabled' && value) lastClip = clipboard.readText();
  if (key === 'islandSize' || key === 'islandStyle') resetIslandBounds();
  if (key === 'performanceMode') updatePresenceTimer();
  if ((key === 'islandSize' || key === 'islandExpansion') && targetFolded && motion === 'idle')
    islandInput(true);
  if (key === 'lyricsEnabled') mediaBridge?.setLyricsEnabled?.(value);
  if (key === 'wallpaperSync') {
    if (!value && store.setting('islandSkin') === 'wallpaper')
      store.setSetting('islandSkin', 'obsidian');
    wallpaperColor = null;
    if (value) refreshWallpaperColor();
  }
  emit();
}

function saveRoboKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    throw new Error('Enter an API key up to 300 characters');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable');
  fs.writeFileSync(path.join(root, 'robo-key.bin'), safeStorage.encryptString(value.trim()));
  emit();
}

function roboProviders(refresh = false) {
  if (refresh || cliCheckedAt + 15000 < Date.now()) {
    cliPaths = discoverCli();
    cliCheckedAt = Date.now();
  }
  const hasKey = fs.existsSync(path.join(root, 'robo-key.bin'));
  return {
    cli: cliPaths,
    hasKey,
    provider: chooseProvider(store.setting('roboProvider'), { ...cliPaths, openai: hasKey }),
  };
}

function roboCapabilities() {
  const { provider } = roboProviders();
  return {
    provider,
    screenAttachments: ['codex', 'openai'].includes(provider) && store.setting('roboScreenCapture'),
  };
}

function registerSettings() {
  ipcMain.handle('openSettings', (_event, section) => openSettingsWindow(section));
  const settings = (action, handler) =>
    ipcMain.handle('settings:' + action, (_event, ...args) => {
      if (_event.sender !== settingsWin?.webContents) throw new Error('Invalid settings sender');
      handler?.(...args);
      return currentSettings();
    });
  settings('state');
  settings('set', setHubSetting);
  settings('shortcut', (index, shortcut) => {
    store.setShortcut(index, shortcut);
    emit();
  });
  ipcMain.handle('settings:pickShortcutProgram', async (_event) => {
    if (_event.sender !== settingsWin?.webContents) throw new Error('Invalid settings sender');
    const result = await dialog.showOpenDialog(settingsWin, {
      properties: ['openFile'],
      filters: [{ name: 'Windows apps and shortcuts', extensions: ['exe', 'lnk'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  settings('appVisible', (id, value) => {
    store.setAppVisible(id, value);
    emit();
  });
  settings('hook', (provider, action) => hooks.change(provider, action, hookScript()));
  settings('login', (openAtLogin) => {
    if (!app.isPackaged || process.platform !== 'win32') throw new Error('Startup is unavailable');
    if (typeof openAtLogin !== 'boolean') throw new Error('Invalid startup preference');
    app.setLoginItemSettings({ openAtLogin, path: process.execPath });
  });
  settings('roboKey', saveRoboKey);
  settings('roboDisconnect', () => {
    fs.rmSync(path.join(root, 'robo-key.bin'), { force: true });
    emit();
  });
  ipcMain.handle('openShortcut', async (_event, index) => {
    if (!Number.isInteger(index) || index < 0 || index > 3)
      throw new Error('Invalid shortcut slot');
    const shortcut = store.setting('customShortcuts')[index];
    if (!shortcut) throw new Error('Shortcut has not been configured');
    if (shortcut.type === 'program') {
      if (
        !path.isAbsolute(shortcut.path) ||
        !['.exe', '.lnk'].includes(path.extname(shortcut.path).toLowerCase()) ||
        !fs.existsSync(shortcut.path)
      )
        throw new Error('The selected app is no longer available');
      const error = await shell.openPath(shortcut.path);
      if (error) throw new Error(error);
      return true;
    }
    const url = new URL(shortcut.url);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid shortcut address');
    await shell.openExternal(url.href);
  });
}

function registerGlobalHotkey(accelerator = store.setting('globalHotkey')) {
  const previous = activeGlobalHotkey;
  if (activeGlobalHotkey) {
    globalShortcut.unregister(activeGlobalHotkey);
    activeGlobalHotkey = null;
  }
  if (accelerator === 'disabled') return;
  const toggle = () => {
    if (win && !win.isDestroyed()) resize(!targetFolded);
  };
  if (!globalShortcut.register(accelerator, toggle)) {
    if (previous && globalShortcut.register(previous, toggle)) activeGlobalHotkey = previous;
    throw new Error(`Could not register ${accelerator}; another app may use it`);
  }
  activeGlobalHotkey = accelerator;
}

function register() {
  registerSettings();
  ipcMain.on('noteFlush', (event, body) => {
    try {
      if (event.sender !== win?.webContents) throw new Error('Invalid note sender');
      store.saveNote(body);
      event.returnValue = true;
    } catch (error) {
      event.returnValue = { error: error.message };
    }
  });
  ipcMain.handle('state', current);
  ipcMain.handle('mail:state', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid mail request');
    return mailBridge.state();
  });
  ipcMain.handle('mail:connect', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid mail request');
    return mailBridge.connect();
  });
  ipcMain.handle('mail:disconnect', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid mail request');
    return mailBridge.disconnect();
  });
  ipcMain.handle('mail:refresh', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid mail request');
    return mailBridge.refresh();
  });
  ipcMain.handle('mail:openGmail', (event) => {
    if (event.sender !== win?.webContents) throw new Error('Invalid mail request');
    return shell.openExternal('https://mail.google.com/mail/u/0/#search/is%3Aunread');
  });
  ipcMain.handle('updates:state', () => updateState);
  ipcMain.handle('updates:check', async () => {
    if (!updateState.supported) return updateState;
    updateState = { ...updateState, status: 'checking', message: 'Checking for updates…' };
    sendUpdateState();
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.isUpdateAvailable === false) {
        updateState = { ...updateState, status: 'current', message: 'Queueglow is up to date.' };
        sendUpdateState();
      }
    } catch (error) {
      console.error('Update check failed:', error);
      updateState = {
        ...updateState,
        status: 'error',
        message: updaterErrorMessage(error),
      };
      sendUpdateState();
    }
    return updateState;
  });
  ipcMain.handle('updates:download', async () => {
    if (!updateState.supported || updateState.status !== 'available') return updateState;
    try {
      updateState = {
        ...updateState,
        status: 'downloading',
        percent: 0,
        message: 'Downloading update…',
      };
      sendUpdateState();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('Update download failed:', error);
      updateState = {
        ...updateState,
        status: 'error',
        message: updaterErrorMessage(error),
      };
      sendUpdateState();
    }
    return updateState;
  });
  ipcMain.handle('updates:install', () => {
    if (!updateState.supported || updateState.status !== 'downloaded') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
  ipcMain.handle('fold', () => resize(true));
  ipcMain.handle('expand', () => resize(false));
  ipcMain.handle('quit', () => app.quit());
  ipcMain.handle('setting', (_e, key, value) => {
    setHubSetting(key, value);
    return true;
  });
  ipcMain.handle('appVisible', (_e, id, value) => {
    store.setAppVisible(id, value);
    emit();
    return true;
  });
  ipcMain.handle('focusStart', (_e, mode, seconds) => {
    store.startFocus(mode, seconds);
    emit();
    emitSettingsActivity();
    return true;
  });
  ipcMain.handle('focusStop', () => {
    store.stopFocus();
    emit();
    emitSettingsActivity();
    return true;
  });
  ipcMain.handle('modeOption', (_e, mode, option, enabled) => {
    store.setModeOption(mode, option, enabled);
    emit();
    return true;
  });
  ipcMain.handle('clipClear', () => {
    store.clearClips();
    emit();
    return true;
  });
  ipcMain.handle('clipCopy', (_e, id) => {
    const content = store.clipContent(id);
    if (!content) throw new Error('Clip was removed');
    clipboard.writeText(content);
    lastClip = content;
    return true;
  });
  ipcMain.handle('trayAdd', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return false;
    for (const file of result.filePaths) {
      const stat = fs.statSync(file);
      if (stat.size > 25 * 1024 * 1024) throw new Error('Choose files under 25 MB');
      store.addTrayFile(path.basename(file), fs.readFileSync(file));
    }
    emit();
    return true;
  });
  ipcMain.handle('trayDrop', (_e, name, bytes) => {
    if (
      typeof name !== 'string' ||
      name.length > 180 ||
      !(bytes instanceof Uint8Array) ||
      bytes.length > 25 * 1024 * 1024
    )
      throw new Error('Invalid file');
    store.addTrayFile(name, bytes);
    emit();
    return true;
  });
  ipcMain.handle('trayRemove', (_e, id) => {
    store.removeTrayFile(id);
    emit();
    return true;
  });
  ipcMain.handle('trayOpen', (_e, id) => {
    const file = store.trayPath(id);
    if (file) return shell.showItemInFolder(file);
    throw new Error('File was removed');
  });
  ipcMain.handle('noteSave', (_e, body) => {
    store.saveNote(body);
    emit();
    return true;
  });
  ipcMain.handle('agendaAdd', (_e, title, start, end) => {
    store.addAgendaEvent(title, start, end);
    emit();
    return true;
  });
  ipcMain.handle('agendaRemove', (_e, id) => {
    store.removeAgendaEvent(id);
    emit();
    return true;
  });
  ipcMain.handle('musicOpen', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] }],
    });
    if (result.canceled) return false;
    audio = result.filePaths
      .filter((file) => fs.statSync(file).size < 30 * 1024 * 1024)
      .slice(0, 12)
      .map((file) => ({
        id: crypto.randomUUID(),
        name: path.parse(file).name,
        url: `data:audio/${path.extname(file).slice(1)};base64,${fs.readFileSync(file).toString('base64')}`,
      }));
    emit();
    return true;
  });
  ipcMain.handle('mediaControl', (_e, action, seconds) => {
    if (!['playPause', 'next', 'previous', 'seek'].includes(action))
      throw new Error('Invalid media action');
    return mediaBridge.control(action, seconds);
  });
  ipcMain.handle('volumeSet', (_e, value) => {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Invalid volume');
    return mediaBridge.control('setVolume', value);
  });
  ipcMain.handle('brightnessSet', (_e, value) => {
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Invalid brightness');
    return mediaBridge.control('setBrightness', value);
  });
  ipcMain.handle('radioSet', (_e, target, enabled) => {
    if (!['wifi', 'bluetooth'].includes(target) || typeof enabled !== 'boolean')
      throw new Error('Invalid radio request');
    return mediaBridge.control('setRadio', undefined, { target, enabled });
  });
  ipcMain.handle('openSystemSettings', (_e, target) => {
    const urls = {
      wifi: 'ms-settings:network-wifi',
      bluetooth: 'ms-settings:bluetooth',
      display: 'ms-settings:display',
    };
    if (!Object.hasOwn(urls, target)) throw new Error('Invalid system settings target');
    return shell.openExternal(urls[target]);
  });
  ipcMain.handle('hooks', (_e, action, provider) => hooks.change(provider, action, hookScript()));
  ipcMain.handle('decide', (_e, id, behavior) => {
    if (!['allow', 'deny'].includes(behavior) || !/^[0-9a-f-]{36}$/i.test(id))
      throw new Error('Invalid decision');
    const item = pending.get(id);
    if (!item || item.expires_at <= Date.now() / 1000) throw new Error('Request expired');
    const output = path.join(ipcRoot, 'decisions', `${id}.json`);
    fs.writeFileSync(output, JSON.stringify({ id, behavior }));
    pending.delete(id);
    emit();
    emitSettingsActivity();
    return true;
  });
  ipcMain.handle('roboKey', (_e, value) => saveRoboKey(value));
  ipcMain.handle('roboTargets', async () => {
    if (!roboCapabilities().screenAttachments) return [];
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources
      .filter((source) => source.name && !/queueglow/i.test(source.name))
      .slice(0, 40)
      .map((source) => ({ id: source.id, name: source.name.slice(0, 120) }));
  });
  ipcMain.handle('roboAsk', async (_e, prompt, captureTarget) => {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Type a question');
    if (prompt.length > 2000) throw new Error('Questions can contain up to 2,000 characters');
    if (roboBusy) throw new Error('Robo is already answering a question');
    const { cli, provider } = roboProviders(true);
    if (!provider) throw new Error('Choose an installed agent or add an OpenAI key in AI & Chat');
    roboBusy = true;
    try {
      const screenshot = await captureRoboImage(captureTarget, provider);
      if (provider === 'openai') return await askRoboOpenAI(prompt.trim(), screenshot);
      return await askCli(provider, cli[provider], prompt.trim(), screenshot);
    } finally {
      roboBusy = false;
    }
  });
}

function sendUpdateState() {
  if (win && !win.isDestroyed()) win.webContents.send('updateStatus', updateState);
}

function updaterErrorMessage(error) {
  const status = Number(error?.statusCode || error?.response?.statusCode || 0);
  if (status === 404)
    return 'Update files were not found on GitHub. The release may need to be repaired.';
  if (status === 403) return 'GitHub temporarily blocked the update check. Try again later.';
  if (status) return `Update check failed (HTTP ${status}). Try again later.`;
  return 'Could not check for updates. Try again later.';
}

function configureUpdater() {
  const metadata = path.join(process.resourcesPath, 'app-update.yml');
  const supported = process.platform === 'win32' && app.isPackaged && fs.existsSync(metadata);
  updateState = {
    supported,
    status: 'idle',
    version: app.getVersion(),
    message: supported
      ? ''
      : 'In-app updates are available after installing Queueglow for Windows.',
  };
  if (!supported) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    updateState = { ...updateState, status: 'checking', message: 'Checking for updates…' };
    sendUpdateState();
  });
  autoUpdater.on('update-available', (info) => {
    updateState = {
      ...updateState,
      version: info.version,
      status: 'downloading',
      percent: 0,
      message: `Downloading version ${info.version} in the background.`,
    };
    sendUpdateState();
  });
  autoUpdater.on('update-not-available', (info) => {
    updateState = {
      ...updateState,
      status: 'current',
      version: info.version || app.getVersion(),
      message: 'Queueglow is up to date.',
    };
    sendUpdateState();
  });
  autoUpdater.on('download-progress', (progress) => {
    updateState = {
      ...updateState,
      status: 'downloading',
      percent: Math.floor(progress.percent),
      message: `Downloading update… ${Math.floor(progress.percent)}%`,
    };
    sendUpdateState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState = {
      ...updateState,
      status: 'downloaded',
      version: info.version,
      percent: 100,
      message: `Version ${info.version} is ready. It will install when you next quit Queueglow.`,
    };
    sendUpdateState();
  });
  autoUpdater.on('error', (error) => {
    console.error('Auto-update error:', error);
    updateState = { ...updateState, status: 'error', message: updaterErrorMessage(error) };
    sendUpdateState();
  });
}

async function refreshWallpaperColor() {
  if (!store?.setting('wallpaperSync')) return;
  const nextColor = await wallpaperAccent();
  if (nextColor && nextColor !== wallpaperColor) {
    wallpaperColor = nextColor;
    emit();
  }
}

async function captureRoboImage(target, provider) {
  if (target == null || target === 'none') return null;
  if (!store.setting('roboScreenCapture'))
    throw new Error('Screen attachments are disabled in Settings');
  if (provider === 'claude') throw new Error('Claude Code in Robo supports text questions only');
  if (typeof target !== 'string' || target.length > 200) throw new Error('Invalid capture target');
  const isScreen = target === 'screen';
  const sources = await desktopCapturer.getSources({
    types: [isScreen ? 'screen' : 'window'],
    thumbnailSize: { width: 1280, height: 720 },
  });
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const selected = isScreen
    ? sources.find((source) => source.display_id === String(display.id)) || sources[0]
    : sources.find((source) => source.id === target && !/queueglow/i.test(source.name));
  if (!selected || selected.thumbnail.isEmpty()) throw new Error('Could not capture the screen');
  return selected.thumbnail.toPNG();
}

async function askRoboOpenAI(prompt, screenshot) {
  const file = path.join(root, 'robo-key.bin');
  const key = safeStorage.decryptString(fs.readFileSync(file));
  const content = [{ type: 'input_text', text: prompt }];
  if (screenshot) {
    content.push({
      type: 'input_image',
      image_url: 'data:image/png;base64,' + screenshot.toString('base64'),
    });
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      max_output_tokens: 1500,
      input: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('OpenAI could not answer. Check the API key in AI & Chat.');
  const data = await response.json();
  return clipAnswer(
    (data.output || [])
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n'),
  );
}
app.whenReady().then(() => {
  fs.mkdirSync(root, { recursive: true });
  removeLegacyGmailSession();
  store = new HubStore(root);
  let googleClientId = '';
  try {
    googleClientId = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'dist', 'queueglow-google-oauth.json'), 'utf8'),
    ).clientId;
  } catch {}
  mailBridge = new MailBridge({
    clientId: googleClientId,
    file: path.join(root, 'google-mail-session.bin'),
    safeStorage,
    openExternal: (url) => shell.openExternal(url),
    onChange: (mail) => emit({ mail }),
  });
  mailBridge.initialize().catch(() => {});
  setInterval(() => mailBridge?.refresh().catch(() => {}), 5 * 60 * 1000);
  register();
  configureUpdater();
  try {
    registerGlobalHotkey();
  } catch (error) {
    console.warn('Global shortcut unavailable:', error.message);
  }
  openWindow();
  openTray();
  if (store.setting('wallpaperSync')) refreshWallpaperColor();
  setInterval(refreshWallpaperColor, 10 * 60 * 1000);
  if (updateState.supported) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 12000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  }
  mediaBridge = new MediaBridge(process.resourcesPath, () => emit());
  mediaBridge.setLyricsEnabled?.(store.setting('lyricsEnabled'));
  mediaBridge.start();
  setInterval(checkPointerExit, 100);
  updatePresenceTimer();
  setInterval(pollEvents, 700);
  pollEvents();
  setInterval(() => {
    if (!store.setting('clipboardEnabled')) return;
    const value = clipboard.readText();
    if (value && value !== lastClip) {
      lastClip = value;
      store.addClip(value);
      emit();
    }
  }, 1200);
});
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => {
  mediaBridge?.stop();
  store?.close();
  app.quit();
});

