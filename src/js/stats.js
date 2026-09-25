/* ---------- stats.js: every number and series the screens show ----------

Stats.cols() turns the plays into typed columns once per data version; every function below
works on an index range [i0, i1) of those columns (the selected period).
A play "counts" when it lasted at least Settings.minPlaySec (or when its length is unknown:
Last.fm and Spotify's recently played only report real plays). Minutes include every play.
*/

const DEFAULT_TRACK_MS = 210000;

const Stats = {
  _cols: null, _ver: -1, _setKey: '',
  cache: new Map(),

  cols() {
    const setKey = Settings.get('minPlaySec') + '|' + Settings.get('sessionGapMin');
    if (this._cols && this._ver === Store.version && this._setKey === setKey) return this._cols;
    this.cache.clear();
    const P = Store.plays, n = P.length, tracks = Store.tracks;
    const minMs = Settings.get('minPlaySec') * 1000;

    // Estimated length per track for plays whose length is unknown: known duration, else the
    // average of complete JSON plays, else a typical song length.
    const nT = tracks.length;
    const sum = new Float64Array(nT), cnt = new Uint32Array(nT);
    const doneReason = Store.reasons.indexOf('trackdone');
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (p.ms > 30000 && (doneReason < 0 || p.re === doneReason)) { sum[p.tr] += p.ms; cnt[p.tr]++; }
    }
    const est = new Float64Array(nT);
    for (let t = 0; t < nT; t++) est[t] = tracks[t].dur || (cnt[t] ? sum[t] / cnt[t] : DEFAULT_TRACK_MS);

    const c = {
      n, T: new Float64Array(n), MS: new Float64Array(n), CNT: new Uint8Array(n), DAY: new Int32Array(n),
      HOUR: new Uint8Array(n), TR: new Int32Array(n), AR: new Int32Array(n), AL: new Int32Array(n),
      F: new Uint16Array(n), P: new Uint8Array(n), C: new Uint8Array(n), RS: new Uint8Array(n), RE: new Uint8Array(n),
      KNOWN: new Uint8Array(n), est,
    };
    let lastHourStart = -Infinity, lastOffset = 0;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      c.T[i] = p.t;
      c.MS[i] = p.ms >= 0 ? p.ms : est[p.tr];
      c.KNOWN[i] = p.ms >= 0 ? 1 : 0;
      c.CNT[i] = p.ms < 0 || p.ms >= minMs ? 1 : 0;
      // Timezone offset only changes on DST switches; recompute it once per hour of data.
      if (p.t - lastHourStart >= 3600000 || p.t < lastHourStart) {
        lastHourStart = p.t - (p.t % 3600000);
        lastOffset = new Date(p.t).getTimezoneOffset() * 60000;
      }
      const local = p.t - lastOffset;
      c.DAY[i] = Math.floor(local / DAY);
      c.HOUR[i] = Math.floor((local % DAY + DAY) % DAY / 3600000);
      const tr = tracks[p.tr];
      c.TR[i] = p.tr; c.AR[i] = tr.a; c.AL[i] = tr.al;
      c.F[i] = p.f; c.P[i] = p.p; c.C[i] = p.c; c.RS[i] = p.rs; c.RE[i] = p.re;
    }
    this._cols = c; this._ver = Store.version; this._setKey = setKey;
    return c;
  },

  /** Memoizes per data version and arguments. */
  memo(key, fn) {
    this.cols();
    if (this.cache.has(key)) return this.cache.get(key);
    const v = fn();
    this.cache.set(key, v);
    return v;
  },

  range(period) {
    const c = this.cols();
    return [lowerBound(c.T, period.from), lowerBound(c.T, period.to)];
  },

  /* ---------- totals ---------- */

  totals(i0, i1) {
    return this.memo('tot' + i0 + ':' + i1, () => {
      const c = this.cols();
      let plays = 0, ms = 0, known = 0;
      const tr = new Set(), ar = new Set(), al = new Set(), days = new Set();
      for (let i = i0; i < i1; i++) {
        ms += c.MS[i];
        if (c.KNOWN[i]) known++;
        if (!c.CNT[i]) continue;
        plays++;
        tr.add(c.TR[i]); ar.add(c.AR[i]); if (c.AL[i] >= 0) al.add(c.AL[i]);
        days.add(c.DAY[i]);
      }
      const firstDay = i1 > i0 ? c.DAY[i0] : 0, lastDay = i1 > i0 ? c.DAY[i1 - 1] : 0;
      const spanDays = i1 > i0 ? lastDay - firstDay + 1 : 0;
      return {
        plays, ms, tracks: tr.size, artists: ar.size, albums: al.size, activeDays: days.size, spanDays,
        first: i1 > i0 ? c.T[i0] : 0, last: i1 > i0 ? c.T[i1 - 1] : 0, estimated: i1 - i0 - known, all: i1 - i0,
      };
    });
  },

  /* ---------- time series ---------- */

  /** Buckets: 'day' | 'week' | 'month' | 'year'. Returns {keys, labels, plays, ms}, zero-filled. */
  series(i0, i1, bucket, fromDay, toDay) {
    return this.memo('ser' + [i0, i1, bucket, fromDay, toDay], () => {
      const c = this.cols();
      if (fromDay == null) { fromDay = i1 > i0 ? c.DAY[i0] : dayNum(Date.now()); toDay = i1 > i0 ? c.DAY[i1 - 1] : fromDay; }
      const keyOf = d => {
        if (bucket === 'day') return d;
        if (bucket === 'week') return d - weekdayOfDay(d);
        const k = monthKeyOfDay(d);
        return bucket === 'month' ? k : Math.floor(k / 12);
      };
      const keys = [];
      if (bucket === 'day') for (let d = fromDay; d <= toDay; d++) keys.push(d);
      else if (bucket === 'week') for (let d = keyOf(fromDay); d <= toDay; d += 7) keys.push(d);
      else if (bucket === 'month') for (let k = keyOf(fromDay); k <= keyOf(toDay); k++) keys.push(k);
      else for (let y = keyOf(fromDay); y <= keyOf(toDay); y++) keys.push(y);
      const idx = new Map(keys.map((k, i) => [k, i]));
      const plays = new Float64Array(keys.length), ms = new Float64Array(keys.length);
      for (let i = i0; i < i1; i++) {
        const j = idx.get(keyOf(c.DAY[i]));
        if (j === undefined) continue;
        ms[j] += c.MS[i];
        plays[j] += c.CNT[i];
      }
      const labels = keys.map(k => bucket === 'day' ? fmtDay(k) : bucket === 'week' ? 'недеља од ' + fmtDay(k)
        : bucket === 'month' ? monthKeyLabel(k) : String(k));
      const short = keys.map(k => {
        if (bucket === 'year') return String(k);
        if (bucket === 'month') return (k % 12 === 0 ? String(Math.floor(k / 12)) : MONTHS_SHORT[k % 12]);
        const d = dayDate(k);
        return d.getUTCDate() + '. ' + MONTHS_SHORT[d.getUTCMonth()];
      });
      return { keys, labels, short, plays: Array.from(plays), ms: Array.from(ms) };
    });
  },

  /** 7×24 matrix (Monday first) of plays or ms. */
  hourWeek(i0, i1, metric) {
    return this.memo('hw' + [i0, i1, metric], () => {
      const c = this.cols();
      const m = Array.from({ length: 7 }, () => new Array(24).fill(0));
      for (let i = i0; i < i1; i++) m[weekdayOfDay(c.DAY[i])][c.HOUR[i]] += metric === 'ms' ? c.MS[i] : c.CNT[i];
      return m;
    });
  },
  /** Per-day totals as Map(day → {plays, ms}). */
  days(i0, i1) {
    return this.memo('days' + i0 + ':' + i1, () => {
      const c = this.cols(), m = new Map();
      for (let i = i0; i < i1; i++) {
        let v = m.get(c.DAY[i]);
        if (!v) m.set(c.DAY[i], v = { plays: 0, ms: 0 });
        v.plays += c.CNT[i]; v.ms += c.MS[i];
      }
      return m;
    });
  },

  /** Longest run of days with listening, and the run that ends today (or on the period's last day). */
  streaks(i0, i1) {
    return this.memo('str' + i0 + ':' + i1, () => {
      const days = [...this.days(i0, i1).keys()].sort((a, b) => a - b);
      let best = { len: 0, from: 0, to: 0 }, cur = null;
      for (const d of days) {
        if (cur && d === cur.to + 1) cur.to = d, cur.len++;
        else cur = { len: 1, from: d, to: d };
        if (cur.len > best.len) best = Object.assign({}, cur);
      }
      const today = dayNum(Date.now());
      const current = cur && cur.to >= today - 1 ? cur : null;
      // Longest break between listening days.
      let gap = { len: 0, from: 0, to: 0 };
      for (let i = 1; i < days.length; i++) {
        const g = days[i] - days[i - 1] - 1;
        if (g > gap.len) gap = { len: g, from: days[i - 1] + 1, to: days[i] - 1 };
      }
      return { best, current, gap };
    });
  },

  /** Listening sessions: plays separated by less than the session gap. */
  sessions(i0, i1) {
    return this.memo('ses' + i0 + ':' + i1, () => {
      const c = this.cols(), gap = Settings.get('sessionGapMin') * 60000;
      const list = [];
      let cur = null;
      for (let i = i0; i < i1; i++) {
        const start = c.T[i], end = start + c.MS[i];
        if (cur && start - cur.end <= gap) {
          cur.end = Math.max(cur.end, end); cur.plays += c.CNT[i]; cur.i1 = i + 1;
        } else {
          if (cur) list.push(cur);
          cur = { start, end, plays: c.CNT[i], i0: i, i1: i + 1 };
        }
      }
      if (cur) list.push(cur);
      const lens = list.map(s => s.end - s.start);
      const total = lens.reduce((a, b) => a + b, 0);
      let longest = null;
      for (const s of list) if (!longest || s.end - s.start > longest.end - longest.start) longest = s;
      const buckets = [0, 0, 0, 0, 0, 0]; // <15m, <30m, <1h, <2h, <4h, 4h+
      for (const l of lens) {
        const m = l / 60000;
        buckets[m < 15 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : m < 240 ? 4 : 5]++;
      }
      // Songs that most often open a session.
      const openers = new Map();
      for (const s of list) openers.set(c.TR[s.i0], (openers.get(c.TR[s.i0]) || 0) + 1);
      return { count: list.length, avg: list.length ? total / list.length : 0, longest, buckets, openers: topN(openers, 10, v => v) };
    });
  },

  /** Cumulative minutes by day of year, one series per calendar year in range. */
  yearCompare(i0, i1) {
    return this.memo('yc' + i0 + ':' + i1, () => {
      const c = this.cols(), years = new Map();
      for (let i = i0; i < i1; i++) {
        const d = dayDate(c.DAY[i]);
        const y = d.getUTCFullYear();
        let arr = years.get(y);
        if (!arr) years.set(y, arr = new Float64Array(366));
        const doy = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / DAY);
        arr[doy] += c.MS[i];
      }
      const today = new Date();
      const out = [];
      for (const [y, arr] of [...years].sort((a, b) => a[0] - b[0])) {
        const len = y === today.getFullYear() ? Math.floor((Date.UTC(y, today.getMonth(), today.getDate()) - Date.UTC(y, 0, 1)) / DAY) + 1
          : (y % 4 === 0 ? 366 : 365);
        const vals = new Array(len);
        let acc = 0;
        for (let d = 0; d < len; d++) { acc += arr[d]; vals[d] = acc / 3600000; }
        out.push({ year: y, values: vals });
      }
      return out;
    });
  },

  /* ---------- tops ---------- */

  /** kind: 'track' | 'artist' | 'album'. Returns [{id, plays, ms}] sorted by metric. */
  top(i0, i1, kind, metric = 'plays', filter) {
    const key = 'top' + [i0, i1, kind, metric, filter ? filter.key : ''];
    return this.memo(key, () => {
      const c = this.cols();
      const col = kind === 'track' ? c.TR : kind === 'artist' ? c.AR : c.AL;
      const size = kind === 'track' ? Store.tracks.length : kind === 'artist' ? Store.artists.length : Store.albums.length;
      const plays = new Float64Array(size), ms = new Float64Array(size);
      for (let i = i0; i < i1; i++) {
        const id = col[i];
        if (id < 0) continue;
        if (filter && !filter.test(i)) continue;
        plays[id] += c.CNT[i]; ms[id] += c.MS[i];
      }
      const out = [];
      for (let id = 0; id < size; id++) if (plays[id] || ms[id]) out.push({ id, plays: plays[id], ms: ms[id] });
      out.sort(metric === 'ms' ? (a, b) => b.ms - a.ms : (a, b) => b.plays - a.plays || b.ms - a.ms);
      return out;
    });
  },
  rankMap(i0, i1, kind, metric) {
    return this.memo('rank' + [i0, i1, kind, metric], () => {
      const m = new Map();
      this.top(i0, i1, kind, metric).forEach((x, i) => m.set(x.id, i + 1));
      return m;
    });
  },

  /* ---------- per-entity index (all time) ---------- */

  /** For each track (or artist), the indexes of its plays, in time order. CSR layout. */
  byEntity(kind) {
    return this.memo('by' + kind, () => {
      const c = this.cols();
      const col = kind === 'track' ? c.TR : c.AR;
      const size = kind === 'track' ? Store.tracks.length : Store.artists.length;
      const start = new Uint32Array(size + 1);
      for (let i = 0; i < c.n; i++) start[col[i] + 1]++;
      for (let k = 0; k < size; k++) start[k + 1] += start[k];
      const fill = start.slice(0, size);
      const idx = new Uint32Array(c.n);
      for (let i = 0; i < c.n; i++) idx[fill[col[i]]++] = i;
      return { start, idx };
    });
  },
  entityPlays(kind, id) {
    const b = this.byEntity(kind);
    return b.idx.subarray(b.start[id], b.start[id + 1]);
  },

  /** First counted play of every track and artist (all time). */
  firsts() {
    return this.memo('firsts', () => {
      const c = this.cols();
      const tr = new Float64Array(Store.tracks.length).fill(Infinity);
      const ar = new Float64Array(Store.artists.length).fill(Infinity);
      const trI = new Int32Array(Store.tracks.length).fill(-1);
      for (let i = 0; i < c.n; i++) {
        if (!c.CNT[i]) continue;
        if (tr[c.TR[i]] === Infinity) { tr[c.TR[i]] = c.T[i]; trI[c.TR[i]] = i; }
        if (ar[c.AR[i]] === Infinity) ar[c.AR[i]] = c.T[i];
      }
      return { tr, ar, trI };
    });
  },

  /** New artists and songs per month (first ever play inside the period). */
  discoveries(i0, i1) {
    return this.memo('disc' + i0 + ':' + i1, () => {
      const c = this.cols(), f = this.firsts();
      if (i1 <= i0) return { keys: [], artists: [], tracks: [], newArtists: [], newTracks: [] };
      const from = c.T[i0], to = c.T[i1 - 1];
      const k0 = monthKeyOfDay(c.DAY[i0]), k1 = monthKeyOfDay(c.DAY[i1 - 1]);
      const keys = [];
      for (let k = k0; k <= k1; k++) keys.push(k);
      const artists = new Array(keys.length).fill(0), tracks = new Array(keys.length).fill(0);
      const monthOfT = t => monthKeyOfDay(dayNum(t)) - k0;
      const newArtists = [], newTracks = [];
      f.ar.forEach((t, id) => { if (t >= from && t <= to) { artists[monthOfT(t)]++; newArtists.push(id); } });
      f.tr.forEach((t, id) => { if (t >= from && t <= to) { tracks[monthOfT(t)]++; newTracks.push(id); } });
      // Rank the new ones by how much they were played in the period.
      const ap = this.top(i0, i1, 'artist'), tp = this.top(i0, i1, 'track');
      const aSet = new Set(newArtists), tSet = new Set(newTracks);
      return {
        keys, artists, tracks,
        newArtists: ap.filter(x => aSet.has(x.id)), newTracks: tp.filter(x => tSet.has(x.id)),
      };
    });
  },

  /** Times of the 1st, 10th, 50th … counted play of a track or artist. */
  milestones(kind, id) {
    const c = this.cols(), idx = this.entityPlays(kind, id);
    const marks = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    const out = [];
    let n = 0, mi = 0;
    for (const i of idx) {
      if (!c.CNT[i]) continue;
      n++;
      if (n === marks[mi]) { out.push({ n, t: c.T[i] }); mi++; }
    }
    return out;
  },

  /**
   * "Obsessions": songs with an intense 30-day peak that later faded.
   * Score = plays in the best 30 days; faded = in the 180 days after, under a quarter of that.
   */
  obsessions(i0, i1) {
    return this.memo('obs' + i0 + ':' + i1, () => {
      const c = this.cols(), b = this.byEntity('track');
      if (i1 <= i0) return [];
      const from = c.T[i0], to = c.T[i1 - 1];
      const out = [];
      for (let id = 0; id < Store.tracks.length; id++) {
        const n = b.start[id + 1] - b.start[id];
        if (n < 12) continue;
        const idx = b.idx.subarray(b.start[id], b.start[id + 1]);
        const ts = [];
        for (const i of idx) if (c.CNT[i]) ts.push(c.T[i]);
        if (ts.length < 12) continue;
        let best = 0, bestStart = 0, j = 0;
        for (let k = 0; k < ts.length; k++) {
          while (ts[k] - ts[j] > 30 * DAY) j++;
          if (k - j + 1 > best) { best = k - j + 1; bestStart = ts[j]; }
        }
        if (best < 10 || bestStart < from || bestStart > to) continue;
        const peakEnd = bestStart + 30 * DAY;
        let after = 0;
        for (const t of ts) if (t > peakEnd && t <= peakEnd + 180 * DAY) after++;
        const total = ts.length;
        out.push({ id, peak: best, peakStart: bestStart, after, total, faded: after < best / 4 && peakEnd + 180 * DAY < Date.now() });
      }
      out.sort((a, b) => b.peak - a.peak);
      return out;
    });
  },

  /** Songs that came back after at least a year of silence (return inside the period). */
  comebacks(i0, i1) {
    return this.memo('cb' + i0 + ':' + i1, () => {
      const c = this.cols(), b = this.byEntity('track');
      if (i1 <= i0) return [];
      const from = c.T[i0], to = c.T[i1 - 1];
      const out = [];
      for (let id = 0; id < Store.tracks.length; id++) {
        const idx = b.idx.subarray(b.start[id], b.start[id + 1]);
        if (idx.length < 4) continue;
        let prev = -1, before = 0;
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          if (!c.CNT[i]) continue;
          const t = c.T[i];
          if (prev >= 0 && t - prev >= 365 * DAY && t >= from && t <= to) {
            let after = 0;
            for (let m = k; m < idx.length && c.T[idx[m]] - t < 90 * DAY; m++) after += c.CNT[idx[m]];
            if (after >= 2) out.push({ id, gap: t - prev, back: t, before, after });
          }
          prev = t; before++;
        }
      }
      out.sort((a, b) => b.gap - a.gap);
      return out;
    });
  },

  /** Per calendar year: variety of listening. */
  diversity(i0, i1) {
    return this.memo('div' + i0 + ':' + i1, () => {
      const c = this.cols(), f = this.firsts();
      const years = new Map();
      for (let i = i0; i < i1; i++) {
        if (!c.CNT[i]) continue;
        const y = dayDate(c.DAY[i]).getUTCFullYear();
        let v = years.get(y);
        if (!v) years.set(y, v = { plays: 0, art: new Map(), tr: new Set(), newPlays: 0 });
        v.plays++;
        v.art.set(c.AR[i], (v.art.get(c.AR[i]) || 0) + 1);
        v.tr.add(c.TR[i]);
        if (new Date(f.ar[c.AR[i]]).getFullYear() === y) v.newPlays++;
      }
      return [...years].sort((a, b) => a[0] - b[0]).map(([y, v]) => {
        const counts = [...v.art.values()].sort((a, b) => b - a);
        let acc = 0, half = 0;
        for (const x of counts) { acc += x; half++; if (acc >= v.plays / 2) break; }
        const top10 = counts.slice(0, 10).reduce((a, b) => a + b, 0);
        return { year: y, plays: v.plays, artists: v.art.size, tracks: v.tr.size, half, top10Share: top10 / v.plays, newShare: v.newPlays / v.plays };
      });
    });
  },

  /** Share of the top artists per month (or year), the rest folded into "other". */
  artistShare(i0, i1, nTop = 6) {
    return this.memo('share' + [i0, i1, nTop], () => {
      const c = this.cols();
      if (i1 <= i0) return null;
      const byYear = c.DAY[i1 - 1] - c.DAY[i0] > 4 * 365;
      const bucket = d => byYear ? dayDate(d).getUTCFullYear() : monthKeyOfDay(d);
      const k0 = bucket(c.DAY[i0]), k1 = bucket(c.DAY[i1 - 1]);
      const tops = this.top(i0, i1, 'artist').slice(0, nTop).map(x => x.id);
      const slot = new Map(tops.map((id, k) => [id, k]));
      const n = k1 - k0 + 1;
      const vals = Array.from({ length: nTop + 1 }, () => new Float64Array(n));
      const tot = new Float64Array(n);
      for (let i = i0; i < i1; i++) {
        if (!c.CNT[i]) continue;
        const b = bucket(c.DAY[i]) - k0;
        const s = slot.has(c.AR[i]) ? slot.get(c.AR[i]) : nTop;
        vals[s][b]++; tot[b]++;
      }
      const series = vals.map((v, k) => ({
        name: k < tops.length ? Store.artists[tops[k]].n : 'Остали',
        values: Array.from(v, (x, j) => tot[j] ? x / tot[j] : 0),
      })).filter((s, k) => k < tops.length || k === nTop);
      const labels = [];
      for (let k = k0; k <= k1; k++) labels.push(byYear ? String(k) : monthKeyLabel(k));
      const short = [];
      for (let k = k0; k <= k1; k++) short.push(byYear ? String(k) : (k % 12 === 0 ? String(Math.floor(k / 12)) : MONTHS_SHORT[k % 12]));
      return { labels, short, series, totals: Array.from(tot) };
    });
  },

  /** Frames for the bar chart race: cumulative plays per artist (or track), month by month. */
  race(i0, i1, kind = 'artist', nTop = 10) {
    return this.memo('race' + [i0, i1, kind], () => {
      const c = this.cols();
      if (i1 <= i0) return [];
      const col = kind === 'track' ? c.TR : c.AR;
      const acc = new Map();
      const frames = [];
      let curKey = monthKeyOfDay(c.DAY[i0]);
      const snap = k => {
        const top = topN(acc, nTop, v => v).map(([id, v]) => ({ id, v }));
        frames.push({ label: monthKeyLabel(k), items: top });
      };
      for (let i = i0; i < i1; i++) {
        const k = monthKeyOfDay(c.DAY[i]);
        while (k > curKey) { snap(curKey); curKey++; }
        if (c.CNT[i]) acc.set(col[i], (acc.get(col[i]) || 0) + 1);
      }
      snap(curKey);
      return frames;
    });
  },

  /* ---------- habits (need the JSON export: skips, shuffle, platform, country) ---------- */

  habits(i0, i1) {
    return this.memo('hab' + i0 + ':' + i1, () => {
      const c = this.cols();
      const R = Store.reasons;
      const fwd = R.indexOf('fwdbtn'), done = R.indexOf('trackdone');
      let json = 0, skipped = 0, shuffle = 0, offline = 0, incognito = 0, completed = 0;
      const plat = new Map(), country = new Map(), rs = new Map(), re = new Map();
      const years = new Map();
      const trSkip = new Map(), arSkip = new Map();
      for (let i = i0; i < i1; i++) {
        if (!(c.F[i] & SRC_JSON)) continue;
        json++;
        const f = c.F[i];
        const isSkip = (f & F_SKIPPED) || (fwd > 0 && c.RE[i] === fwd);
        if (isSkip) skipped++;
        if (f & F_SHUFFLE) shuffle++;
        if (f & F_OFFLINE) offline++;
        if (f & F_INCOGNITO) incognito++;
        if (done > 0 && c.RE[i] === done) completed++;
        if (c.P[i]) plat.set(c.P[i], (plat.get(c.P[i]) || 0) + c.MS[i]);
        if (c.C[i]) country.set(c.C[i], (country.get(c.C[i]) || 0) + 1);
        if (c.RS[i]) rs.set(c.RS[i], (rs.get(c.RS[i]) || 0) + 1);
        if (c.RE[i]) re.set(c.RE[i], (re.get(c.RE[i]) || 0) + 1);
        const y = dayDate(c.DAY[i]).getUTCFullYear();
        let yv = years.get(y);
        if (!yv) years.set(y, yv = { n: 0, skip: 0, shuffle: 0, offline: 0, plat: new Map() });
        yv.n++; if (isSkip) yv.skip++; if (f & F_SHUFFLE) yv.shuffle++; if (f & F_OFFLINE) yv.offline++;
        if (c.P[i]) yv.plat.set(c.P[i], (yv.plat.get(c.P[i]) || 0) + c.MS[i]);
        let ts = trSkip.get(c.TR[i]);
        if (!ts) trSkip.set(c.TR[i], ts = [0, 0]);
        ts[0]++; if (isSkip) ts[1]++;
        let as = arSkip.get(c.AR[i]);
        if (!as) arSkip.set(c.AR[i], as = [0, 0]);
        as[0]++; if (isSkip) as[1]++;
      }
      const rate = (m, min) => [...m].filter(([, v]) => v[0] >= min).map(([id, v]) => ({ id, n: v[0], skip: v[1], rate: v[1] / v[0] }));
      const trRates = rate(trSkip, 8);
      const arRates = rate(arSkip, 20);
      return {
        json, skipped, shuffle, offline, incognito, completed,
        platforms: [...plat].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: Store.platforms[k], ms: v })),
        countries: [...country].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ code: Store.countries[k], n: v })),
        reasonStart: [...rs].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: Store.reasons[k], n: v })),
        reasonEnd: [...re].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: Store.reasons[k], n: v })),
        years: [...years].sort((a, b) => a[0] - b[0]).map(([y, v]) => ({ year: y, n: v.n, skip: v.skip / v.n, shuffle: v.shuffle / v.n, offline: v.offline / v.n, plat: v.plat })),
        mostSkipped: trRates.slice().sort((a, b) => b.rate - a.rate || b.n - a.n).slice(0, 25),
        neverSkipped: trRates.slice().sort((a, b) => a.rate - b.rate || b.n - a.n).slice(0, 25),
        artistSkips: arRates.sort((a, b) => b.rate - a.rate).slice(0, 25),
      };
    });
  },

  /** Share of plays by artist group (tags), per year. */
  groups(i0, i1) {
    return this.memo('grp' + i0 + ':' + i1 + JSON.stringify(Settings.get('tagNames')), () => {
      const c = this.cols(), tags = Settings.get('tagNames');
      const years = new Map();
      for (let i = i0; i < i1; i++) {
        if (!c.CNT[i]) continue;
        const y = dayDate(c.DAY[i]).getUTCFullYear();
        let v = years.get(y);
        if (!v) years.set(y, v = { n: 0, tags: new Array(tags.length).fill(0) });
        v.n++;
        const at = Store.artists[c.AR[i]].tags;
        if (at && at.length) tags.forEach((tg, k) => { if (at.includes(tg)) v.tags[k]++; });
      }
      return { tags, years: [...years].sort((a, b) => a[0] - b[0]).map(([y, v]) => ({ year: y, n: v.n, shares: v.tags.map(x => x / v.n) })) };
    });
  },

  /* ---------- summaries ---------- */

  /** The busiest single days, and the most repeats of one song in a day. */
  records(i0, i1) {
    return this.memo('rec' + i0 + ':' + i1, () => {
      const c = this.cols();
      const days = [...this.days(i0, i1)].sort((a, b) => b[1].ms - a[1].ms);
      let rep = { n: 0, id: -1, day: 0 };
      let curDay = -1;
      const cnt = new Map();
      const flush = () => { for (const [id, n] of cnt) if (n > rep.n) rep = { n, id, day: curDay }; cnt.clear(); };
      for (let i = i0; i < i1; i++) {
        if (c.DAY[i] !== curDay) { flush(); curDay = c.DAY[i]; }
        if (c.CNT[i]) cnt.set(c.TR[i], (cnt.get(c.TR[i]) || 0) + 1);
      }
      flush();
      const months = this.series(i0, i1, 'month');
      let bestM = -1;
      months.ms.forEach((v, k) => { if (bestM < 0 || v > months.ms[bestM]) bestM = k; });
      const hw = this.hourWeek(i0, i1, 'ms');
      const hours = new Array(24).fill(0), wdays = new Array(7).fill(0);
      hw.forEach((row, w) => row.forEach((v, hh) => { hours[hh] += v; wdays[w] += v; }));
      return {
        topDays: days.slice(0, 10).map(([d, v]) => ({ day: d, ms: v.ms, plays: v.plays })),
        repeat: rep,
        bestMonth: bestM >= 0 ? { label: months.labels[bestM], ms: months.ms[bestM] } : null,
        bestHour: hours.indexOf(Math.max(...hours)),
        bestWeekday: wdays.indexOf(Math.max(...wdays)),
        hours, wdays,
      };
    });
  },
};
