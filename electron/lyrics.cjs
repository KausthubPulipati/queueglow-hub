const MAX_LINES = 240;
const MAX_TEXT = 12000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const LIMITED = Symbol('rate limited');

function parseSyncedLyrics(raw) {
  if (typeof raw !== 'string') return [];
  const lines = [];
  for (const row of raw.slice(0, MAX_TEXT).split(/\r?\n/)) {
    const match = /^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/.exec(row);
    if (!match) continue;
    const seconds = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`);
    const text = match[4].trim().slice(0, 220);
    if (text && Number.isFinite(seconds)) lines.push({ at: seconds, text });
    if (lines.length >= MAX_LINES) break;
  }
  return lines.sort((a, b) => a.at - b.at);
}

function lyricAt(lines, seconds) {
  if (!Array.isArray(lines) || !Number.isFinite(seconds)) return '';
  let current = '';
  for (const line of lines) {
    if (line.at > seconds + 0.15) break;
    current = line.text;
  }
  return current;
}

function simplifiedTitle(title) {
  return title.replace(/\s*\((?:from|feat\.?|ft\.?).*\)$/i, '').trim();
}

function safeMatch(record, title, artist, duration) {
  if (!record || typeof record !== 'object') return false;
  const queryTitle = simplifiedTitle(title).toLocaleLowerCase();
  const candidateTitle = String(record.trackName || record.name || '').toLocaleLowerCase();
  const candidateArtist = String(record.artistName || '').toLocaleLowerCase();
  if (
    !queryTitle ||
    !candidateTitle.startsWith(queryTitle) ||
    candidateArtist !== artist.toLocaleLowerCase()
  )
    return false;
  return !Number.isFinite(duration) || duration <= 0 || Math.abs(record.duration - duration) <= 4;
}

class LyricsClient {
  constructor(fetcher = globalThis.fetch, now = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
    this.cache = new Map();
    this.blockedUntil = 0;
    this.lastRequestAt = 0;
    this.requestChain = Promise.resolve();
  }

  async lookup(track) {
    const title = String(track?.title || '')
      .trim()
      .slice(0, 180);
    const artist = String(track?.artist || '')
      .trim()
      .slice(0, 180);
    if (!title || !artist || !this.fetcher) return null;
    if (this.now() < this.blockedUntil) return null;
    const key = `${artist.toLocaleLowerCase()}\0${title.toLocaleLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && cached.until > this.now()) return cached.value;
    const pending = Promise.resolve()
      .then(() => this.fetchLyrics(title, artist, track.duration))
      .then((value) => {
        if (value === LIMITED) {
          this.cache.delete(key);
          return null;
        }
        this.cache.set(key, {
          value,
          until: this.now() + (value ? CACHE_TTL_MS : MISS_TTL_MS),
        });
        return value;
      })
      .catch(() => {
        this.cache.set(key, { value: null, until: this.now() + MISS_TTL_MS });
        return null;
      });
    this.cache.set(key, { pending, until: this.now() + MISS_TTL_MS });
    return pending;
  }

  request(url) {
    const next = this.requestChain.then(async () => {
      if (this.now() < this.blockedUntil) return LIMITED;
      const delay = Math.max(0, this.lastRequestAt + 300 - this.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.now() < this.blockedUntil) return LIMITED;
      const response = await this.fetcher(url, {
        headers: {
          'User-Agent': 'Queueglow v0.1 (https://github.com/KausthubPulipati/queueglow-hub)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
      this.lastRequestAt = this.now();
      if ([429, 503].includes(response.status)) {
        const raw = response.headers?.get?.('Retry-After');
        const seconds = Number(raw);
        const parsed =
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.parse(raw) - this.now();
        const fallback = response.status === 429 ? 60000 : 5000;
        const wait = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
        this.blockedUntil = this.now() + Math.min(3600000, Math.max(1000, wait * 1.15));
        return LIMITED;
      }
      return response;
    });
    this.requestChain = next.catch(() => {});
    return next;
  }

  async fetchLyrics(title, artist, duration) {
    const query = new URLSearchParams({ track_name: simplifiedTitle(title), artist_name: artist });
    if (Number.isFinite(duration) && duration >= 1 && duration <= 3600)
      query.set('duration', String(Math.round(duration)));
    const response = await this.request(`https://lrclib.net/api/get?${query}`);
    if (response === LIMITED) return LIMITED;
    let data;
    if (response.ok) data = await response.json();
    else if (response.status === 404) {
      const search = new URLSearchParams({
        track_name: simplifiedTitle(title),
        artist_name: artist,
      });
      const fallback = await this.request(`https://lrclib.net/api/search?${search}`);
      if (fallback === LIMITED) return LIMITED;
      if (!fallback.ok) return null;
      const candidates = await fallback.json();
      if (!Array.isArray(candidates)) return null;
      data = candidates
        .filter((record) => safeMatch(record, title, artist, duration))
        .sort((a, b) => {
          const sync = Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
          return sync || Math.abs(a.duration - duration) - Math.abs(b.duration - duration);
        })[0];
    } else return null;
    const lines = parseSyncedLyrics(data?.syncedLyrics);
    const plain = typeof data?.plainLyrics === 'string' ? data.plainLyrics.slice(0, MAX_TEXT) : '';
    return lines.length || plain ? { lines, plain } : null;
  }
}

module.exports = { LyricsClient, parseSyncedLyrics, lyricAt };
