/* ---------- spotify.js: login (Authorization Code + PKCE) and Web API client ----------

Development-mode limits (since February 2026) this client respects:
  - search returns at most 10 results per request,
  - no batch track/artist/album lookups (one item per request, done lazily for covers),
  - library writes go through /me/library?uris=…, playlist tracks through /playlists/{id}/items,
  - only your own playlists can be read item by item.
*/

const IS_APP = !!window.AppAndroid;
const PAGES_URL = 'https://kosmet-crypto.github.io/Spotify-Stats/';
const SP_SCOPES = [
  'user-read-recently-played', 'user-top-read', 'user-read-playback-state', 'user-modify-playback-state',
  'user-read-currently-playing', 'user-library-read', 'user-library-modify', 'user-follow-read',
  'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-private', 'playlist-modify-public',
  'ugc-image-upload',
];

class ApiError extends Error {
  constructor(status, message, reason) { super(message); this.status = status; this.reason = reason; }
}

const SP = {
  defaultRedirect() {
    // The web version on GitHub Pages handles its own callback; the Android app uses the same page,
    // which forwards the login back into the app (slusaonica://callback).
    if (!IS_APP && location.hostname.endsWith('github.io')) return new URL('callback.html', location.href).href;
    return PAGES_URL + 'callback.html';
  },
  redirectUri() { return Settings.get('redirectUri') || this.defaultRedirect(); },
  configured() { return !!Settings.get('clientId'); },

  webTokens() { return lsGet('sp_tokens', null); },
  loggedIn() {
    if (IS_APP) { try { return AppAndroid.loggedIn(); } catch (e) { return false; } }
    const t = this.webTokens();
    return !!(t && t.refresh);
  },

  async login() {
    const clientId = Settings.get('clientId');
    if (!clientId) throw new Error('Прво упиши Client ID');
    const verifier = randomString(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = (IS_APP ? 'a' : 'w') + randomString(16);
    lsSet('sp_pkce', { verifier, state, redirect: this.redirectUri(), clientId });
    const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: clientId, scope: SP_SCOPES.join(' '),
      redirect_uri: this.redirectUri(), state, code_challenge_method: 'S256', code_challenge: challenge,
    });
    if (IS_APP) AppAndroid.openExternal(url);
    else location.href = url;
  },

  /** Finishes the login from the redirect URL's query (?code=…&state=… or ?error=…). */
  async finishLogin(query) {
    const q = new URLSearchParams(query);
    const pk = lsGet('sp_pkce', null);
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Пријава је отказана' : 'Spotify: ' + q.get('error'));
    if (!pk || q.get('state') !== pk.state) throw new Error('Пријава је истекла, покушај поново');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: q.get('code'), redirect_uri: pk.redirect,
        client_id: pk.clientId, code_verifier: pk.verifier,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Spotify пријава није успела: ' + (j.error_description || j.error || res.status));
    localStorage.removeItem('sp_pkce');
    const tokens = { clientId: pk.clientId, access: j.access_token, refresh: j.refresh_token, expiresIn: j.expires_in };
    if (IS_APP) AppAndroid.setTokens(JSON.stringify(tokens));
    else lsSet('sp_tokens', { clientId: pk.clientId, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
    this.me = null;
  },

  logout() {
    if (IS_APP) AppAndroid.clearTokens();
    localStorage.removeItem('sp_tokens');
    Settings.set('bgSync', false);
    this.me = null;
  },

  async token() {
    if (IS_APP) {
      // Blocks briefly while the app refreshes; the app keeps one refresh at a time for the background job too.
      const r = JSON.parse(AppAndroid.accessToken());
      if (r.token) return r.token;
      throw new ApiError(0, r.error === 'logged_out' ? 'Ниси пријављен на Spotify' : 'Нема интернета', r.error);
    }
    const t = this.webTokens();
    if (!t || !t.refresh) throw new ApiError(0, 'Ниси пријављен на Spotify', 'logged_out');
    if (t.access && t.exp - 60000 > Date.now()) return t.access;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        let res;
        try {
          res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId }),
          });
        } catch (e) {
          throw new ApiError(0, 'Нема интернета', 'offline');
        }
        const j = await res.json().catch(() => ({}));
        if (res.status === 400 || res.status === 401) {
          localStorage.removeItem('sp_tokens');
          throw new ApiError(401, 'Spotify пријава је истекла, пријави се поново', 'logged_out');
        }
        if (!res.ok) throw new ApiError(res.status, 'Spotify не одговара', 'offline');
        lsSet('sp_tokens', { clientId: t.clientId, access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + j.expires_in * 1000 });
        return j.access_token;
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  },

  /** Calls the Web API. path is relative to /v1 (may include a query). */
  async api(path, opts = {}) {
    const token = await this.token();
    const url = path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path;
    const init = { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + token } };
    if (opts.raw) {
      init.body = opts.raw;
      init.headers['Content-Type'] = opts.contentType;
    } else if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      init.headers['Content-Type'] = 'application/json';
    }
    let res;
    try { res = await fetch(url, init); } catch (e) { throw new ApiError(0, 'Нема интернета', 'offline'); }
    if (res.status === 429 && !opts.retried) {
      const wait = Math.min(30, parseInt(res.headers.get('Retry-After') || '3', 10));
      await sleep(wait * 1000);
      return this.api(path, Object.assign({}, opts, { retried: true }));
    }
    if (res.status === 401 && !IS_APP && !opts.retried) {
      const t = this.webTokens();
      if (t) { t.exp = 0; lsSet('sp_tokens', t); }
      return this.api(path, Object.assign({}, opts, { retried: true }));
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) { /* not JSON (e.g. snapshot id text) */ }
    if (!res.ok) {
      const msg = j && j.error ? (j.error.message || j.error) : 'HTTP ' + res.status;
      throw new ApiError(res.status, 'Spotify: ' + msg, j && j.error && j.error.reason);
    }
    return j;
  },

  /** Follows `next` links and collects `items` (limit caps the total). */
  async all(path, limit = 5000, onPage) {
    let url = path, out = [];
    while (url && out.length < limit) {
      const j = await this.api(url);
      const page = j.items ? j : (j.artists || j);
      out = out.concat(page.items || []);
      if (onPage) onPage(out.length, page.total);
      url = page.next;
    }
    return out;
  },

  async profile() {
    if (!this.me) this.me = await this.api('/me');
    return this.me;
  },

  /* ---------- player ---------- */

  async playTrack(uri) {
    try {
      await this.api('/me/player/play', { method: 'PUT', body: { uris: [uri] } });
      return true;
    } catch (e) {
      // No active device: open the song in the Spotify app instead.
      if (e.status === 404 || e.reason === 'NO_ACTIVE_DEVICE') { openExternal(spotifyOpenUrl(uri)); return false; }
      throw e;
    }
  },

  /* ---------- library (Feb 2026 generic endpoints) ---------- */

  async isSaved(uris) {
    const r = await this.api('/me/library/contains?uris=' + encodeURIComponent(uris.join(',')));
    return Array.isArray(r) ? r : [];
  },
  async save(uris, on) {
    await this.api('/me/library?uris=' + encodeURIComponent(uris.join(',')), { method: on ? 'PUT' : 'DELETE' });
  },

  /* ---------- lookups for covers and missing links ---------- */

  async searchTracks(q, limit = 10) {
    const j = await this.api('/search?' + new URLSearchParams({ q, type: 'track', limit: String(Math.min(10, limit)) }));
    return (j && j.tracks && j.tracks.items) || [];
  },
  async search(q) {
    return await this.api('/search?' + new URLSearchParams({ q, type: 'track,artist', limit: '10' }));
  },
  /** Finds the Spotify URI for a local track (Last.fm-only tracks have none). */
  async resolveTrack(id) {
    const t = Store.tracks[id];
    if (t.uri) return t.uri;
    const artist = Store.artists[t.a].n;
    const items = await this.searchTracks('track:' + t.n + ' artist:' + artist, 5);
    const want = trackKey(artist, t.n);
    const hit = items.find(x => trackKey(x.artists[0].name, x.name) === want) || items[0];
    if (!hit) return null;
    t.uri = hit.uri;
    if (!t.dur) t.dur = hit.duration_ms;
    setCoverFromAlbum(t, hit.album);
    Covers.dirty();
    return t.uri;
  },
};

function setCoverFromAlbum(t, album) {
  const imgs = album && album.images;
  if (!imgs || !imgs.length) return;
  const img = (imgs[1] || imgs[0]).url;
  if (!t.img) t.img = img;
  if (t.al >= 0 && !Store.albums[t.al].img) Store.albums[t.al].img = img;
}

function openExternal(url) {
  if (!url) return;
  if (IS_APP) AppAndroid.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Covers: fetched one track at a time (dev mode has no batch lookups), only for what is on screen,
 * and remembered in the database.
 */
const Covers = {
  queue: [], queued: new Set(), running: false, listeners: new Map(),
  want(trackId, cb) {
    const t = Store.tracks[trackId];
    if (!t || t.img) return;
    if (!t.uri || !SP.loggedIn() || t.noImg) return;
    if (cb) {
      if (!this.listeners.has(trackId)) this.listeners.set(trackId, []);
      this.listeners.get(trackId).push(cb);
    }
    if (this.queued.has(trackId)) return;
    this.queued.add(trackId);
    this.queue.push(trackId);
    this.run();
  },
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        const t = Store.tracks[id];
        try {
          const j = await SP.api('/tracks/' + spotifyIdFromUri(t.uri));
          setCoverFromAlbum(t, j.album);
          if (j.artists && j.artists[0]) Store.artists[t.a].sid = Store.artists[t.a].sid || j.artists[0].id;
          if (!t.img) t.noImg = true;
          this.dirty();
          (this.listeners.get(id) || []).forEach(cb => cb(t.img));
        } catch (e) {
          if (e.reason === 'logged_out' || e.reason === 'offline') { this.queue = []; break; }
          t.noImg = true;
        }
        this.listeners.delete(id);
        await sleep(120);
      }
    } finally {
      this.running = false;
      this.queued.clear();
    }
  },
  dirty: debounce(() => { Store.saveDict(); }, 4000),
};
