const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, ...args) => ipcRenderer.invoke(name, ...args);
function subscribe(name, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(name, handler);
  return () => ipcRenderer.removeListener(name, handler);
}

const settings = {
  state: () => invoke('settings:state'),
  set: (key, value) => invoke('settings:set', key, value),
  shortcut: (index, shortcut) => invoke('settings:shortcut', index, shortcut),
  pickShortcutProgram: () => invoke('settings:pickShortcutProgram'),
  appVisible: (id, visible) => invoke('settings:appVisible', id, visible),
  hook: (provider, action) => invoke('settings:hook', provider, action),
  login: (enabled) => invoke('settings:login', enabled),
  roboKey: (key) => invoke('settings:roboKey', key),
  roboDisconnect: () => invoke('settings:roboDisconnect'),
  onNavigate: (callback) => subscribe('settings:navigate', callback),
  onActivity: (callback) => subscribe('settings:activity', callback),
};

const hub = {
  state: () => invoke('state'),
  openSettings: (section) => invoke('openSettings', section),
  openShortcut: (index) => invoke('openShortcut', index),
  fold: () => invoke('fold'),
  expand: () => invoke('expand'),
  quit: () => invoke('quit'),
  setting: (key, value) => invoke('setting', key, value),
  appVisible: (id, visible) => invoke('appVisible', id, visible),
  focusStart: (mode, seconds) => invoke('focusStart', mode, seconds),
  focusStop: () => invoke('focusStop'),
  modeOption: (mode, option, enabled) => invoke('modeOption', mode, option, enabled),
  clipClear: () => invoke('clipClear'),
  clipCopy: (id) => invoke('clipCopy', id),
  trayAdd: () => invoke('trayAdd'),
  trayDrop: (name, bytes) => invoke('trayDrop', name, bytes),
  trayRemove: (id) => invoke('trayRemove', id),
  trayOpen: (id) => invoke('trayOpen', id),
  noteSave: (body) => invoke('noteSave', body),
  noteFlush: (body) => ipcRenderer.sendSync('noteFlush', body),
  agendaAdd: (title, start, end) => invoke('agendaAdd', title, start, end),
  agendaRemove: (id) => invoke('agendaRemove', id),
  musicOpen: () => invoke('musicOpen'),
  mediaControl: (action, seconds) => invoke('mediaControl', action, seconds),
  volumeSet: (value) => invoke('volumeSet', value),
  brightnessSet: (value) => invoke('brightnessSet', value),
  radioSet: (target, enabled) => invoke('radioSet', target, enabled),
  openSystemSettings: (target) => invoke('openSystemSettings', target),
  hooks: (action, provider) => invoke('hooks', action, provider),
  decide: (id, behavior) => invoke('decide', id, behavior),
  roboAsk: (prompt, captureTarget) => invoke('roboAsk', prompt, captureTarget),
  roboTargets: () => invoke('roboTargets'),
  roboKey: (key) => invoke('roboKey', key),
  mailState: () => invoke('mail:state'),
  mailConnect: () => invoke('mail:connect'),
  mailDisconnect: () => invoke('mail:disconnect'),
  mailRefresh: () => invoke('mail:refresh'),
  mailOpenUnread: () => invoke('mail:openGmail'),
  updateState: () => invoke('updates:state'),
  checkForUpdates: () => invoke('updates:check'),
  downloadUpdate: () => invoke('updates:download'),
  installUpdate: () => invoke('updates:install'),
  onUpdate: (callback) => subscribe('update', callback),
  onUpdateStatus: (callback) => subscribe('updateStatus', callback),
  onMotion: (callback) => subscribe('motion', callback),
  onPresence: (callback) => subscribe('presence', callback),
};

if (process.argv.includes('--queueglow-settings')) {
  contextBridge.exposeInMainWorld('queueglowSettings', settings);
} else {
  contextBridge.exposeInMainWorld('hub', hub);
}

