const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const APP_IDS = [
  'home',
  'codex',
  'robo',
  'music',
  'focus',
  'modes',
  'tray',
  'clips',
  'note',
  'agenda',
  'mail',
];
const MODE_DEFAULTS = [
  ['work', 'Work', 50 * 60],
  ['study', 'Study', 45 * 60],
  ['rest', 'Sleep', 25 * 60],
  ['play', 'Game', 30 * 60],
];
const SETTING_DEFAULTS = {
  clipboardEnabled: false,
  notifications: true,
  sound: true,
  reduceMotion: false,
  notifyApprovals: true,
  notifyCompletion: false,
  notifyErrors: true,
  notificationPresentation: 'summary',
  globalHotkey: 'Control+Alt+Q',
  focusGuard: false,
  islandSize: 'standard',
  islandStyle: 'attached',
  islandMaterial: 'black',
  islandTransparency: 20,
  musicColor: false,
  systemIndicators: true,
  islandSkin: 'obsidian',
  wallpaperSync: false,
  clockFormat: '12h',
  clockShowSeconds: false,
  clockSize: 'standard',
  clockStyle: 'digital',
  clockLeadingZero: false,
  showDate: true,
  islandExpansion: 'hover',
  restingIndicator: 'eyes',
  roboAppearance: 'cyan',
  roboName: 'Robo',
  roboEyeTracking: true,
  roboBlinking: true,
  roboDance: false,
  roboSleepAfter: '30',
  roboScreenCapture: true,
  roboProvider: 'auto',
  lyricsEnabled: false,
  animationSpeed: 'normal',
  performanceMode: 'automatic',
  appAnimations: true,
  customShortcuts: [null, null, null, null],
};
const CHOICES = {
  globalHotkey: ['Control+Alt+Q', 'Control+Alt+Space', 'Control+Shift+Q', 'disabled'],
  notificationPresentation: ['summary', 'private'],
  islandSize: ['compact', 'standard', 'large'],
  islandStyle: ['attached', 'floating'],
  islandMaterial: ['black', 'glass'],
  islandSkin: ['obsidian', 'slate', 'violet', 'glass', 'mint', 'rose', 'sunset', 'wallpaper'],
  clockFormat: ['12h', '24h'],
  clockSize: ['compact', 'standard', 'large'],
  clockStyle: ['digital', 'rounded'],
  islandExpansion: ['hover', 'click'],
  restingIndicator: ['eyes', 'dot', 'none'],
  roboAppearance: ['cyan', 'violet', 'mint'],
  roboSleepAfter: ['30', '60', '120', 'never'],
  animationSpeed: ['fast', 'normal'],
  performanceMode: ['automatic', 'light', 'smooth', 'max'],
  roboProvider: ['auto', 'codex', 'claude', 'openai'],
};
const MAX_TRAY_FILE = 25 * 1024 * 1024;

function now() {
  return new Date().toISOString();
}
function id() {
  return crypto.randomUUID();
}
function text(value, limit) {
  return String(value ?? '')
    .trim()
    .slice(0, limit);
}

class HubStore {
  constructor(root, schemaPath = path.join(__dirname, 'schema.sql')) {
    this.root = root;
    this.trayRoot = path.join(root, 'tray');
    fs.mkdirSync(this.trayRoot, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'hub.db'), { timeout: 2000 });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(fs.readFileSync(schemaPath, 'utf8'));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (
        !this.db
          .prepare('PRAGMA table_info(agent_events)')
          .all()
          .some(({ name }) => name === 'detail')
      ) {
        this.db.exec("ALTER TABLE agent_events ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const insertMode = this.db.prepare(
      'INSERT OR IGNORE INTO mode_profiles(id,name,duration_seconds,updated_at) VALUES(?,?,?,?)',
    );
    for (const mode of MODE_DEFAULTS) insertMode.run(...mode, now());
    this.db.prepare("UPDATE mode_profiles SET name='Sleep' WHERE id='rest'").run();
    this.db.prepare("UPDATE mode_profiles SET name='Game' WHERE id='play'").run();
    const insertApp = this.db.prepare(
      'INSERT OR IGNORE INTO app_preferences(app_id,visible,sort_order,updated_at) VALUES(?,1,?,?)',
    );
    APP_IDS.forEach((appId, index) => insertApp.run(appId, index, now()));
  }

  setting(key) {
    if (!Object.hasOwn(SETTING_DEFAULTS, key)) throw new Error('Unknown setting');
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value_json) : SETTING_DEFAULTS[key];
  }

  writeSetting(key, value) {
    this.db
      .prepare(
        'INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
      )
      .run(key, JSON.stringify(value), now());
    return value;
  }

  setSetting(key, value) {
    if (!Object.hasOwn(SETTING_DEFAULTS, key) || key === 'customShortcuts')
      throw new Error('Invalid setting');
    const valid = Object.hasOwn(CHOICES, key)
      ? CHOICES[key].includes(value)
      : key === 'islandTransparency'
        ? Number.isInteger(value) && value >= 0 && value <= 40
        : key === 'roboName'
          ? typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 24
          : typeof value === 'boolean';
    if (!valid) throw new Error('Invalid setting');
    return this.writeSetting(key, value);
  }

  setShortcut(index, shortcut) {
    if (!Number.isInteger(index) || index < 0 || index >= SETTING_DEFAULTS.customShortcuts.length)
      throw new Error('Invalid shortcut slot');
    let entry = null;
    if (shortcut !== null) {
      const { label, url, type = 'website', path: programPath } = shortcut || {};
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 32)
        throw new Error('Enter a shortcut label of 1 to 32 characters');
      if (!['website', 'program'].includes(type))
        throw new Error('Choose a website or Windows app');
      if (type === 'program') {
        if (
          typeof programPath !== 'string' ||
          !path.isAbsolute(programPath) ||
          programPath.length > 2048 ||
          !['.exe', '.lnk'].includes(path.extname(programPath).toLowerCase()) ||
          !fs.existsSync(programPath) ||
          !fs.statSync(programPath).isFile()
        )
          throw new Error('Choose an existing Windows app or shortcut');
        entry = { label: label.trim(), type, path: programPath };
      } else {
        let target;
        if (typeof url === 'string' && url.length <= 2048) {
          try {
            target = new URL(url.trim());
          } catch {}
        }
        if (
          !target ||
          target.href.length > 2048 ||
          target.protocol !== 'https:' ||
          target.username ||
          target.password ||
          !/^https:\/\/[^/?#\\\s]/i.test(url.trim()) ||
          /[\\\x00-\x20]/.test(url.trim())
        )
          throw new Error('Enter a complete HTTPS address without sign-in credentials');
        entry = { label: label.trim(), url: target.href };
      }
    }
    const slots = [...this.setting('customShortcuts')];
    slots[index] = entry;
    this.writeSetting('customShortcuts', slots);
    return entry;
  }

  addAgentEvent(raw) {
    if (!raw || !['codex', 'claude', 'demo'].includes(raw.provider))
      throw new Error('Invalid provider');
    const eventId = text(raw.id, 80) || id();
    const jobId = text(raw.session_id, 128) || `${raw.provider}:local`;
    const kind = [
      'start',
      'activity',
      'permission',
      'decision',
      'done',
      'error',
      'system',
    ].includes(raw.kind)
      ? raw.kind
      : 'system';
    const summary = text(raw.summary, 180) || kind;
    const detail =
      kind === 'done' && typeof raw.detail === 'string'
        ? text(raw.detail, 4000)
        : kind === 'activity' &&
            typeof raw.detail === 'string' &&
            /^(?:File|Files|Test suite): /.test(raw.detail)
          ? text(raw.detail, 500)
          : '';
    const occurredAt = /^\d{4}-\d\d-\d\dT/.test(String(raw.happened_at))
      ? String(raw.happened_at)
      : now();
    const state = {
      start: 'working',
      activity: 'working',
      permission: 'attention',
      decision: 'working',
      done: 'done',
      error: 'error',
      system: 'idle',
    }[kind];
    this.db
      .prepare(
        'INSERT INTO agent_jobs(id,provider,title,state,started_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
      )
      .run(jobId, raw.provider, '', state, occurredAt, occurredAt);
    this.db
      .prepare(
        'INSERT OR IGNORE INTO agent_events(id,job_id,provider,kind,summary,occurred_at,detail) VALUES(?,?,?,?,?,?,?)',
      )
      .run(eventId, jobId, raw.provider, kind, summary, occurredAt, detail);
    return {
      id: eventId,
      job_id: jobId,
      provider: raw.provider,
      kind,
      summary,
      detail,
      occurred_at: occurredAt,
    };
  }

  addClip(raw) {
    const content = text(raw, 12000);
    if (!content) return null;
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const kind = /^https?:\/\//i.test(content) ? 'link' : 'text';
    const clip = {
      id: id(),
      kind,
      preview: content.slice(0, 220),
      content,
      content_hash: hash,
      captured_at: now(),
    };
    this.db
      .prepare(
        'INSERT INTO clips(id,kind,preview,content,content_hash,captured_at) VALUES(@id,@kind,@preview,@content,@content_hash,@captured_at) ON CONFLICT(content_hash) DO UPDATE SET captured_at=excluded.captured_at',
      )
      .run(clip);
    this.db
      .prepare(
        'DELETE FROM clips WHERE id NOT IN (SELECT id FROM clips ORDER BY captured_at DESC LIMIT 80)',
      )
      .run();
    return clip;
  }

  clearClips() {
    this.db.prepare('DELETE FROM clips').run();
  }
  clipContent(clipId) {
    return (
      this.db.prepare('SELECT content FROM clips WHERE id=?').get(String(clipId))?.content || null
    );
  }

  addTrayFile(fileName, bytes) {
    const name = path.basename(text(fileName, 180)).replace(/[<>:"|?*\x00-\x1f]/g, '_');
    const data = Buffer.from(bytes);
    if (!name || !data.length || data.length > MAX_TRAY_FILE)
      throw new Error('Choose a file under 25 MB');
    const fileId = id();
    const storedName = `${fileId}${path.extname(name).slice(0, 12)}`;
    fs.writeFileSync(path.join(this.trayRoot, storedName), data, { flag: 'wx' });
    this.db
      .prepare('INSERT INTO tray_items(id,name,stored_name,byte_size,added_at) VALUES(?,?,?,?,?)')
      .run(fileId, name, storedName, data.length, now());
    return fileId;
  }

  trayPath(fileId) {
    const row = this.db
      .prepare('SELECT stored_name FROM tray_items WHERE id=?')
      .get(String(fileId));
    return row ? path.join(this.trayRoot, row.stored_name) : null;
  }

  removeTrayFile(fileId) {
    const file = this.trayPath(fileId);
    if (!file) return false;
    this.db.prepare('DELETE FROM tray_items WHERE id=?').run(String(fileId));
    fs.rmSync(file, { force: true });
    return true;
  }

  saveNote(body) {
    if (typeof body !== 'string') throw new Error('Invalid note');
    if (body.length > 30000) throw new Error('Notes can contain up to 30,000 characters');
    this.db
      .prepare(
        'INSERT INTO notes(id,body,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at',
      )
      .run('main', body, now());
    return body;
  }

  addAgendaEvent(title, start, end) {
    const clean = text(title, 120);
    const begins = new Date(start),
      finishes = new Date(end);
    if (!clean || Number.isNaN(+begins) || Number.isNaN(+finishes) || finishes <= begins)
      throw new Error('Enter a title and a valid time range');
    this.db
      .prepare('INSERT INTO agenda_events(id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)')
      .run(id(), clean, begins.toISOString(), finishes.toISOString(), now());
  }

  removeAgendaEvent(eventId) {
    this.db.prepare('DELETE FROM agenda_events WHERE id=?').run(String(eventId));
  }

  startFocus(modeId, seconds) {
    const duration = Number(seconds);
    if (!Number.isInteger(duration) || duration < 60 || duration > 86400)
      throw new Error('Choose a duration from 1 minute to 24 hours');
    if (!this.db.prepare('SELECT id FROM mode_profiles WHERE id=?').get(String(modeId)))
      throw new Error('Unknown mode');
    this.db
      .prepare("UPDATE focus_sessions SET state='done',updated_at=? WHERE state='running'")
      .run(now());
    const sessionId = id(),
      started = now(),
      deadline = new Date(Date.now() + duration * 1000).toISOString();
    this.db
      .prepare(
        "INSERT INTO focus_sessions(id,mode_id,planned_seconds,deadline_at,state,started_at,updated_at) VALUES(?,?,?,?, 'running',?,?)",
      )
      .run(sessionId, modeId, duration, deadline, started, started);
    return sessionId;
  }

  stopFocus() {
    this.db
      .prepare("UPDATE focus_sessions SET state='done',updated_at=? WHERE state='running'")
      .run(now());
  }

  setModeOption(modeId, option, enabled) {
    const columns = {
      blockSites: 'block_sites',
      quietContacts: 'quiet_contacts',
      keepMusic: 'keep_music',
    };
    const column = columns[option];
    if (!column || typeof enabled !== 'boolean') throw new Error('Invalid mode preference');
    const result = this.db
      .prepare(`UPDATE mode_profiles SET ${column}=?,updated_at=? WHERE id=?`)
      .run(enabled ? 1 : 0, now(), String(modeId));
    if (!result.changes) throw new Error('Unknown mode');
    return true;
  }

  hasActiveFocus() {
    return !!this.db
      .prepare("SELECT 1 FROM focus_sessions WHERE state='running' AND deadline_at>? LIMIT 1")
      .get(now());
  }

  setAppVisible(appId, visible) {
    if (!APP_IDS.includes(appId) || typeof visible !== 'boolean' || appId === 'home')
      throw new Error('Invalid app preference');
    this.db
      .prepare('UPDATE app_preferences SET visible=?,updated_at=? WHERE app_id=?')
      .run(visible ? 1 : 0, now(), appId);
  }

  state() {
    this.db
      .prepare(
        "UPDATE focus_sessions SET state='done',updated_at=? WHERE state='running' AND deadline_at<=?",
      )
      .run(now(), now());
    const settings = Object.fromEntries(
      Object.keys(SETTING_DEFAULTS).map((key) => [key, this.setting(key)]),
    );
    return {
      settings,
      apps: this.db
        .prepare('SELECT app_id AS id,visible,sort_order FROM app_preferences ORDER BY sort_order')
        .all()
        .map((row) => ({ ...row, visible: !!row.visible })),
      jobs: this.db.prepare('SELECT * FROM agent_jobs ORDER BY updated_at DESC LIMIT 20').all(),
      events: this.db
        .prepare('SELECT * FROM agent_events ORDER BY occurred_at DESC, rowid DESC LIMIT 60')
        .all(),
      clips: this.db
        .prepare('SELECT id,kind,preview,captured_at FROM clips ORDER BY captured_at DESC LIMIT 80')
        .all(),
      tray: this.db
        .prepare(
          'SELECT id,name,byte_size,added_at FROM tray_items ORDER BY added_at DESC LIMIT 50',
        )
        .all(),
      note: this.db.prepare("SELECT body FROM notes WHERE id='main'").get()?.body || '',
      agenda: this.db
        .prepare(
          'SELECT id,title,starts_at,ends_at FROM agenda_events ORDER BY starts_at LIMIT 100',
        )
        .all(),
      modes: this.db
        .prepare(
          'SELECT id,name,duration_seconds,block_sites,quiet_contacts,keep_music FROM mode_profiles ORDER BY rowid',
        )
        .all(),
      focus:
        this.db
          .prepare(
            "SELECT id,mode_id,planned_seconds,deadline_at,state,started_at FROM focus_sessions WHERE state='running' ORDER BY started_at DESC LIMIT 1",
          )
          .get() || null,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = { HubStore, APP_IDS, MAX_TRAY_FILE };
