/* ---------- store.js: the local database of plays, tracks, artists and albums ----------

Every play from every source lands here, once:
  - Spotify JSON export (Extended streaming history, or the short account data history),
  - Spotify "recently played" (in the app and from the Android background job),
  - Last.fm scrobbles.

Rules for duplicates (see mergePlays):
  1. The JSON export is the most complete source. For the time it covers, it replaces the
     other sources: their plays inside that time are dropped.
  2. Outside that time, Spotify and Last.fm plays of the same song within 5 minutes of each
     other are one play (each source can "claim" a play only once, so repeats stay separate).
  3. Importing the same data twice changes nothing.
*/

const SRC_JSON = 1, SRC_API = 2, SRC_LFM = 4, SRC_MASK = 7;
const F_SHUFFLE = 8, F_SKIPPED = 16, F_OFFLINE = 32, F_INCOGNITO = 64;
const MATCH_WINDOW = 5 * 60000;
const COVERAGE_GAP = 7 * DAY;

const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('slusaonica', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      req.onsuccess = () => { DB.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = DB.db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
      out = fn(t);
    });
  },
  get(store, key) {
    return new Promise((resolve, reject) => {
      const r = DB.db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  getAll(store) {
    return new Promise((resolve, reject) => {
      const r = DB.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  put(store, key, value) {
    return DB.tx([store], 'readwrite', t => { t.objectStore(store).put(value, key); });
  },
};

const Store = {
  tracks: [],      // {n: name, a: artist id, al: album id, uri, dur, img}
  artists: [],     // {n: name, tags: [], img, uri}
  albums: [],      // {n: name, a: artist id, img}
  trackByKey: new Map(),
  artistByKey: new Map(),
  albumByKey: new Map(),
  rawCache: new Map(),
  plays: [],      // sorted by t: {t: start ms, ms: played ms or -1, tr, f, p, c, rs, re}
  platforms: [''], countries: [''], reasons: [''],
  coverage: [],    // [[from, to], …] times covered by the JSON export
  meta: {},        // sync cursors and import history
  version: 0,      // bumped on every change; stats caches key on it
  dictDirty: false,

  async load() {
    await DB.open();
    const dict = await DB.get('kv', 'dict');
    if (dict) {
      Object.assign(this, {
        tracks: dict.tracks, artists: dict.artists, albums: dict.albums,
        platforms: dict.platforms, countries: dict.countries, reasons: dict.reasons,
      });
    }
    this.coverage = (await DB.get('kv', 'coverage')) || [];
    this.meta = (await DB.get('kv', 'meta')) || {};
    this.rebuildKeys();
    const chunks = await DB.getAll('chunks');
    const plays = [];
    for (const c of chunks) {
      for (let i = 0; i < c.t.length; i++) {
        plays.push({ t: c.t[i], ms: c.ms[i], tr: c.tr[i], f: c.f[i], p: c.p[i], c: c.c[i], rs: c.rs[i], re: c.re[i] });
      }
    }
    plays.sort((a, b) => a.t - b.t);
    this.plays = plays;
    this.version++;
  },

  rebuildKeys() {
    this.rawCache = new Map();
    this.trackByKey = new Map();
    this.artistByKey = new Map();
    this.albumByKey = new Map();
    this.artists.forEach((a, i) => this.artistByKey.set(normArtist(a.n), i));
    this.albums.forEach((al, i) => this.albumByKey.set(al.a + '|' + foldText(al.n), i));
    this.tracks.forEach((t, i) => this.trackByKey.set(t.a + '|' + normTitle(t.n), i));
  },

  isEmpty() { return this.plays.length === 0; },

  /* ---------- dictionaries ---------- */

  artistId(name) {
    const k = normArtist(name) || '?';
    let id = this.artistByKey.get(k);
    if (id === undefined) {
      id = this.artists.length;
      this.artists.push({ n: name || '?', tags: [] });
      this.artistByKey.set(k, id);
      this.dictDirty = true;
    }
    return id;
  },
  albumId(artistId, name) {
    if (!name) return -1;
    const k = artistId + '|' + foldText(name);
    let id = this.albumByKey.get(k);
    if (id === undefined) {
      id = this.albums.length;
      this.albums.push({ n: name, a: artistId });
      this.albumByKey.set(k, id);
      this.dictDirty = true;
    }
    return id;
  },
  /** Finds or creates the track for {name, artist, album, uri, dur, img}; fills in missing details. */
  trackId(info) {
    // Normalizing names is the slow part of a big import; the same raw names repeat a lot.
    const raw = info.artist + '\u0002' + info.name;
    let id = this.rawCache.get(raw);
    let a, t;
    if (id === undefined) {
      a = this.artistId(info.artist);
      id = this.trackByKey.get(a + '|' + normTitle(info.name));
    } else {
      a = this.tracks[id].a;
    }
    if (id === undefined) {
      const k = a + '|' + normTitle(info.name);
      id = this.tracks.length;
      t = { n: info.name || '?', a, al: this.albumId(a, info.album) };
      this.tracks.push(t);
      this.trackByKey.set(k, id);
      this.dictDirty = true;
    } else {
      t = this.tracks[id];
      if (t.al < 0 && info.album) { t.al = this.albumId(a, info.album); this.dictDirty = true; }
    }
    this.rawCache.set(raw, id);
    if (info.uri && !t.uri && info.uri.startsWith('spotify:track:')) { t.uri = info.uri; this.dictDirty = true; }
    if (info.dur && !t.dur) { t.dur = info.dur; this.dictDirty = true; }
    if (info.img && !t.img) {
      t.img = info.img;
      if (t.al >= 0 && !this.albums[t.al].img) this.albums[t.al].img = info.img;
      this.dictDirty = true;
    }
    return id;
  },
  strId(table, value) {
    if (!value) return 0;
    let i = table.indexOf(value);
    if (i < 0) {
      if (table.length >= 255) return 0;
      i = table.length;
      table.push(value);
      this.dictDirty = true;
    }
    return i;
  },

  /* ---------- plays ---------- */

  inCoverage(t) {
    for (const [a, b] of this.coverage) if (t >= a && t <= b) return true;
    return false;
  },
  /** Index of the first play with start time >= t. */
  lb(t) {
    const p = this.plays;
    let lo = 0, hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid].t < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  },

  /**
   * Adds plays from one source. items: {t (start ms), ms (played ms, or -1 if unknown), name, artist,
   * album, uri, dur, img, flags, platform, country, reasonStart, reasonEnd}.
   * JSON items also carry `file` (their source file) for coverage.
   * Returns {added, merged, skipped}.
   */
  async mergePlays(src, items) {
    const res = { added: 0, merged: 0, skipped: 0 };
    if (!items.length) return res;
    const dirty = new Set();
    const pending = [];
    const pendingKeys = new Set();

    if (src === SRC_JSON) {
      // Coverage: one interval per file, joined when the gap between them is small.
      const byFile = new Map();
      for (const it of items) {
        const end = it.t + Math.max(0, it.ms);
        const r = byFile.get(it.file);
        if (!r) byFile.set(it.file, [it.t, end]);
        else { if (it.t < r[0]) r[0] = it.t; if (end > r[1]) r[1] = end; }
      }
      const cov = this.coverage.concat([...byFile.values()]).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of cov) {
        const last = merged[merged.length - 1];
        if (last && r[0] - last[1] <= COVERAGE_GAP) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      this.coverage = merged;
      // Other sources give way inside the covered time.
      const keep = [];
      for (const p of this.plays) {
        if (!(p.f & SRC_JSON) && this.inCoverage(p.t)) { dirty.add(monthOf(p.t)); continue; }
        keep.push(p);
      }
      this.plays = keep;
    }

    for (const it of items) {
      if (src !== SRC_JSON && this.inCoverage(it.t)) { res.skipped++; continue; }
      const tr = this.trackId(it);
      const i0 = this.lb(it.t - MATCH_WINDOW);
      let best = null, bestD = Infinity, dup = false;
      for (let i = i0; i < this.plays.length; i++) {
        const p = this.plays[i];
        if (p.t > it.t + MATCH_WINDOW) break;
        if (p.tr !== tr) continue;
        const d = Math.abs(p.t - it.t);
        if (p.f & src) {
          // The same play from the same source (re-import or overlapping fetch).
          if (d < (src === SRC_JSON ? 2000 : 90000)) { dup = true; break; }
        } else if (src !== SRC_JSON && d < bestD) {
          best = p; bestD = d;
        }
      }
      const pk = tr + ':' + Math.round(it.t / 1000);
      if (dup || pendingKeys.has(pk)) { res.skipped++; continue; }
      if (best) {
        best.f |= src;
        dirty.add(monthOf(best.t));
        res.merged++;
        continue;
      }
      pendingKeys.add(pk);
      pending.push({
        t: it.t, ms: it.ms == null ? -1 : it.ms, tr, f: src | (it.flags || 0),
        p: this.strId(this.platforms, it.platform), c: this.strId(this.countries, it.country),
        rs: this.strId(this.reasons, it.reasonStart), re: this.strId(this.reasons, it.reasonEnd),
      });
      dirty.add(monthOf(it.t));
      res.added++;
    }
    if (pending.length) {
      this.plays = this.plays.concat(pending);
      this.plays.sort((a, b) => a.t - b.t);
    }
    if (dirty.size || this.dictDirty || src === SRC_JSON) {
      this.version++;
      await this.save(src === SRC_JSON ? null : dirty);
    }
    return res;
  },

  /** Removes everything one source added (plays that other sources also have stay). */
  async removeSource(src) {
    const keep = [];
    for (const p of this.plays) {
      p.f &= ~src;
      if (p.f & SRC_MASK) keep.push(p);
    }
    this.plays = keep;
    if (src === SRC_JSON) this.coverage = [];
    if (src === SRC_LFM) delete this.meta.lastfm;
    if (src === SRC_API) delete this.meta.recent;
    if (src === SRC_JSON) delete this.meta.imports;
    this.version++;
    await this.save(null);
  },

  async wipe() {
    Object.assign(this, {
      tracks: [], artists: [], albums: [], plays: [], coverage: [], meta: {},
      platforms: [''], countries: [''], reasons: [''],
    });
    this.rebuildKeys();
    this.version++;
    await this.save(null);
  },

  /** Writes the dictionaries and the given months (a Set of 'YYYY-MM'), or every month when null. */
  async save(months) {
    const byMonth = new Map();
    for (const p of this.plays) {
      const k = monthOf(p.t);
      if (months && !months.has(k)) continue;
      let arr = byMonth.get(k);
      if (!arr) byMonth.set(k, arr = []);
      arr.push(p);
    }
    if (months) for (const k of months) if (!byMonth.has(k)) byMonth.set(k, []);
    const dict = {
      tracks: this.tracks, artists: this.artists, albums: this.albums,
      platforms: this.platforms, countries: this.countries, reasons: this.reasons,
    };
    await DB.tx(['kv', 'chunks'], 'readwrite', t => {
      const kv = t.objectStore('kv');
      kv.put(dict, 'dict');
      kv.put(this.coverage, 'coverage');
      kv.put(this.meta, 'meta');
      const ch = t.objectStore('chunks');
      if (!months) ch.clear();
      for (const [k, arr] of byMonth) {
        if (!arr.length) { ch.delete(k); continue; }
        ch.put(packChunk(arr), k);
      }
    });
    this.dictDirty = false;
  },
  async saveMeta() { await DB.put('kv', 'meta', this.meta); },
  async saveDict() {
    await DB.put('kv', 'dict', {
      tracks: this.tracks, artists: this.artists, albums: this.albums,
      platforms: this.platforms, countries: this.countries, reasons: this.reasons,
    });
    this.dictDirty = false;
  },

  /* ---------- backup ---------- */

  snapshot() {
    return {
      app: 'slusaonica', version: 1, exported: Date.now(),
      dict: {
        tracks: this.tracks, artists: this.artists, albums: this.albums,
        platforms: this.platforms, countries: this.countries, reasons: this.reasons,
      },
      coverage: this.coverage, meta: this.meta,
      plays: {
        t: this.plays.map(p => p.t), ms: this.plays.map(p => p.ms), tr: this.plays.map(p => p.tr),
        f: this.plays.map(p => p.f), p: this.plays.map(p => p.p), c: this.plays.map(p => p.c),
        rs: this.plays.map(p => p.rs), re: this.plays.map(p => p.re),
      },
    };
  },
  async restore(data) {
    if (!data || data.app !== 'slusaonica' || !data.plays) throw new Error('Ово није бекап Слушаонице');
    const d = data.dict, P = data.plays;
    Object.assign(this, {
      tracks: d.tracks, artists: d.artists, albums: d.albums,
      platforms: d.platforms, countries: d.countries, reasons: d.reasons,
      coverage: data.coverage || [], meta: data.meta || {},
    });
    const plays = [];
    for (let i = 0; i < P.t.length; i++) {
      plays.push({ t: P.t[i], ms: P.ms[i], tr: P.tr[i], f: P.f[i], p: P.p[i], c: P.c[i], rs: P.rs[i], re: P.re[i] });
    }
    plays.sort((a, b) => a.t - b.t);
    this.plays = plays;
    this.rebuildKeys();
    this.version++;
    await this.save(null);
  },
};

function monthOf(t) { return new Date(t).toISOString().slice(0, 7); }

function packChunk(arr) {
  const n = arr.length;
  const c = {
    t: new Float64Array(n), ms: new Int32Array(n), tr: new Int32Array(n), f: new Uint16Array(n),
    p: new Uint8Array(n), c: new Uint8Array(n), rs: new Uint8Array(n), re: new Uint8Array(n),
  };
  arr.forEach((p, i) => {
    c.t[i] = p.t; c.ms[i] = p.ms; c.tr[i] = p.tr; c.f[i] = p.f; c.p[i] = p.p; c.c[i] = p.c; c.rs[i] = p.rs; c.re[i] = p.re;
  });
  return c;
}

/* ---------- settings (small, kept in localStorage) ---------- */

const SETTINGS_DEFAULTS = {
  minPlaySec: 30,          // a JSON play shorter than this is not counted as a play (it still adds minutes)
  sessionGapMin: 30,       // silence that ends a listening session
  clientId: '',
  redirectUri: '',
  lastfmUser: '',
  lastfmKey: '',
  lastfmAuto: true,        // fetch new scrobbles on start
  recentAuto: true,        // fetch Spotify recently played on start and every few minutes
  bgSync: false,           // Android background job
  theme: 'auto',
  tagNames: ['ExYu'],
};
const Settings = {
  v: Object.assign({}, SETTINGS_DEFAULTS, lsGet('settings', {})),
  get(k) { return this.v[k]; },
  set(k, val) { this.v[k] = val; lsSet('settings', this.v); },
};
