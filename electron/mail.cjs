const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const UNREAD_LABEL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels/UNREAD';
const SCOPE = 'https://www.googleapis.com/auth/gmail.labels';
const cleanText = (value, limit = 220) =>
  String(value || '')
    .replace(/[\r\n\0]/g, ' ')
    .trim()
    .slice(0, limit);

class MailBridge {
  constructor({ clientId, file, safeStorage, openExternal, onChange = () => {} }) {
    this.clientId = String(clientId || '').trim();
    this.file = file;
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.onChange = onChange;
    this.tokens = null;
    this.view = {
      configured: Boolean(this.clientId),
      connected: false,
      loading: false,
      unread: null,
      error: '',
    };
  }

  state() {
    return { ...this.view };
  }

  publish(patch = {}) {
    this.view = { ...this.view, ...patch, configured: Boolean(this.clientId) };
    this.onChange(this.state());
    return this.state();
  }

  async initialize() {
    if (!this.clientId || !fs.existsSync(this.file)) return this.state();
    if (!this.safeStorage.isEncryptionAvailable())
      return this.publish({ error: 'Windows secure storage is unavailable.' });
    try {
      this.tokens = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
      return await this.refresh();
    } catch {
      this.clearLocal();
      return this.publish({
        connected: false,
        unread: null,
        error: 'Reconnect your Google account to continue.',
      });
    }
  }

  async connect() {
    if (!this.clientId) throw new Error('Google sign-in is not configured yet.');
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error('Windows secure storage is unavailable.');
    this.publish({ loading: true, error: '' });
    try {
      const result = await this.authorize();
      const tokens = await this.exchangeCode(result.code, result.redirectUri, result.verifier);
      if (
        !String(tokens.scope || '')
          .split(' ')
          .includes(SCOPE)
      )
        throw new Error('Google did not grant the label access needed for the unread count.');
      if (!tokens.refresh_token)
        throw new Error('Google did not return an offline access token. Please sign in again.');
      this.tokens = { ...tokens, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 };
      this.persist();
      return await this.refresh();
    } catch (error) {
      this.publish({ loading: false, error: cleanText(error.message) || 'Google sign-in failed.' });
      throw error;
    }
  }

  authorize() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    return new Promise((resolve, reject) => {
      let settled = false;
      let redirectUri = '';
      let timer;
      const server = http.createServer((request, response) => {
        const callback = new URL(request.url, 'http://127.0.0.1');
        if (request.method !== 'GET' || callback.pathname !== '/') {
          response.writeHead(404).end();
          return;
        }
        if (callback.searchParams.get('state') !== state) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><p>Sign-in could not be verified. Return to Queueglow.</p>');
          finish(new Error('Google sign-in could not be verified.'));
          return;
        }
        const denied = callback.searchParams.get('error');
        const code = callback.searchParams.get('code');
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(
          '<!doctype html><meta charset="utf-8"><p>You can close this tab and return to Queueglow.</p>',
        );
        if (denied) finish(new Error('Google sign-in was cancelled.'));
        else if (code) finish(null, { code, redirectUri, verifier });
        else finish(new Error('Google did not return an authorization code.'));
      });
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (server.listening) server.close();
        error ? reject(error) : resolve(value);
      };
      timer = setTimeout(() => finish(new Error('Google sign-in timed out.')), 5 * 60 * 1000);
      server.once('error', (error) => finish(error));
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        redirectUri = `http://127.0.0.1:${address.port}`;
        const authorization = new URL(AUTH_URL);
        authorization.search = new URLSearchParams({
          client_id: this.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        });
        try {
          await this.openExternal(authorization.href);
        } catch {
          finish(new Error('Could not open your default browser.'));
        }
      });
    });
  }

  async exchangeCode(code, redirectUri, verifier) {
    return this.requestToken(
      new URLSearchParams({
        client_id: this.clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    );
  }

  async requestToken(body) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error_description || data.error || 'Google token request failed.');
    return data;
  }

  async accessToken() {
    if (!this.tokens) throw new Error('Connect a Google account first.');
    if (this.tokens.access_token && this.tokens.expires_at > Date.now() + 60000)
      return this.tokens.access_token;
    if (!this.tokens.refresh_token) throw new Error('Reconnect your Google account to continue.');
    const data = await this.requestToken(
      new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    );
    this.tokens = {
      ...this.tokens,
      ...data,
      refresh_token: data.refresh_token || this.tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };
    this.persist();
    return this.tokens.access_token;
  }

  async refresh() {
    if (!this.tokens) return this.state();
    this.publish({ loading: true, error: '' });
    try {
      const token = await this.accessToken();
      const response = await fetch(UNREAD_LABEL_URL, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) throw new Error('Google sign-in expired. Connect again.');
        throw new Error(data.error?.message || 'Could not refresh the unread mail count.');
      }
      return this.publish({
        connected: true,
        loading: false,
        unread: Number(data.messagesUnread) || 0,
      });
    } catch (error) {
      if (/expired|invalid_grant|unauthorized/i.test(error.message)) {
        this.clearLocal();
        return this.publish({
          connected: false,
          loading: false,
          unread: null,
          error: 'Google sign-in expired. Connect your account again.',
        });
      }
      return this.publish({
        connected: Boolean(this.tokens?.refresh_token),
        loading: false,
        error: cleanText(error.message) || 'Could not refresh the unread mail count.',
      });
    }
  }

  async disconnect() {
    const token = this.tokens?.refresh_token || this.tokens?.access_token;
    if (token) {
      try {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {}
    }
    this.clearLocal();
    return this.publish({ connected: false, loading: false, unread: null, error: '' });
  }

  persist() {
    fs.writeFileSync(this.file, this.safeStorage.encryptString(JSON.stringify(this.tokens)));
  }

  clearLocal() {
    this.tokens = null;
    fs.rmSync(this.file, { force: true });
  }
}

module.exports = { MailBridge, SCOPE };

