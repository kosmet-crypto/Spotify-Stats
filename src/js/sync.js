/* ---------- sync.js: Last.fm scrobbles and Spotify "recently played" ---------- */

const LF_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

const LF = {
  configured() { return !!(Settings.get('lastfmUser') && Settings.get('lastfmKey')); },
  async call(params) {
    const url = 'https://ws.audioscrobbler.com/2.0/?' + new URLSearchParams(Object.assign({
      api_key: Settings.get('lastfmKey'), format: 'json',
    }, params));
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try { res = await fetch(url); } catch (e) { throw new Error('Last.fm: нема интернета'); }
      const j = await res.json().catch(() => null);
      if (j && j.error) {
        if (j.error === 29 || j.error === 8 || j.error === 16) { await sleep(2000 * (attempt + 1)); continue; }
        if (j.error === 10 || j.error === 26) throw new Error('Last.fm: API кључ није исправан');
        if (j.error === 6) throw new Error('Last.fm: корисник не постоји');
        if (j.error === 17) throw new Error('Last.fm: слушања су скривена — у подешавањима Last.fm-а искључи „Hide recent listening“');
        throw new Error('Last.fm: ' + j.message);
      }
      if (!res.ok || !j) { await sleep(1500 * (attempt + 1)); continue; }
      return j;
    }
    throw new Error('Last.fm не одговара, покушај касније');
  },
  async userInfo() {
    const j = await this.call({ method: 'user.getinfo', user: Settings.get('lastfmUser') });
    return j.user;
  },
  toItems(tracks) {
    const out = [];
    for (const t of tracks) {
      if (!t.date || (t['@attr'] && t['@attr'].nowplaying)) continue;
      const img = (t.image || []).find(i => i.size === 'large');
      const src = img && img['#text'] && !img['#text'].includes(LF_PLACEHOLDER) ? img['#text'] : '';
      out.push({
        t: parseInt(t.date.uts, 10) * 1000, ms: -1, name: t.name,
        artist: (t.artist && (t.artist['#text'] || t.artist.name)) || '?',
        album: (t.album && t.album['#text']) || '', img: src,
      });
    }
    return out;
  },
  async page(params) {
    const j = await this.call(Object.assign({ method: 'user.getrecenttracks', user: Settings.get('lastfmUser'), limit: 200 }, params));
    const rt = j.recenttracks;
    const tr = rt.track ? (Array.isArray(rt.track) ? rt.track : [rt.track]) : [];
    return { items: this.toItems(tr), pages: parseInt(rt['@attr'].totalPages, 10) || 0, total: parseInt(rt['@attr'].total, 10) || 0 };
  },

  /**
   * New scrobbles since the last sync, then (step by step, resumable) older history until it is all in.
   * progress(text) reports; returns the number of plays added.
   */
  async sync(progress) {
    const st = Store.meta.lastfm || (Store.meta.lastfm = {});
    if (st.user && st.user !== Settings.get('lastfmUser')) {
      // Another account: start over.
      for (const k of Object.keys(st)) delete st[k];
    }
    st.user = Settings.get('lastfmUser');
    let added = 0;
    // 1. Newer than what we have.
    if (st.newest) {
      let page = 1, pages = 1, batch = [];
      while (page <= pages) {
        const r = await this.page({ from: Math.floor(st.newest / 1000) + 1, page });
        pages = r.pages;
        batch = batch.concat(r.items);
        progress && progress('Last.fm: нова слушања, страна ' + page + '/' + Math.max(1, pages));
        page++;
        await sleep(220);
      }
      if (batch.length) {
        added += (await Store.mergePlays(SRC_LFM, batch)).added;
        st.newest = batch.reduce((m, b) => Math.max(m, b.t), st.newest);
      }
    }
    // 2. Older history (the first time: everything), saved every few pages so it can resume.
    if (!st.done) {
      const to = st.oldest ? Math.floor(st.oldest / 1000) - 1 : Math.floor(Date.now() / 1000);
      let page = 1, pages = 1, batch = [];
      const flush = async () => {
        if (!batch.length) return;
        added += (await Store.mergePlays(SRC_LFM, batch)).added;
        st.oldest = batch.reduce((m, b) => Math.min(m, b.t), st.oldest || Infinity);
        st.newest = batch.reduce((m, b) => Math.max(m, b.t), st.newest || 0);
        batch = [];
        await Store.saveMeta();
      };
      while (page <= pages) {
        const r = await this.page({ to, page });
        pages = r.pages;
        batch = batch.concat(r.items);
        progress && progress('Last.fm: историја, страна ' + page + ' од ' + Math.max(1, pages) + ' (' + fmtInt(r.total) + ' укупно)');
        if (page % 10 === 0) await flush();
        page++;
        await sleep(220);
      }
      await flush();
      st.done = true;
    }
    st.last = Date.now();
    await Store.saveMeta();
    return added;
  },
};

function recentToItem(x) {
  const played = Date.parse(x.played_at);
  const dur = x.duration_ms || 0;
  return {
    t: played - (dur || 180000), ms: -1, name: x.name, artist: x.artist || '?',
    album: x.album || '', uri: x.uri, dur, img: x.img || '',
  };
}

const Sync = {
  busy: false,
  status: '',
  listeners: [],
  onChange(fn) { this.listeners.push(fn); },
  emit() { this.listeners.forEach(fn => fn()); },
  setStatus(s) { this.status = s; this.emit(); },

  /** Plays the Android background job collected while the app was closed. */
  async drainNative() {
    if (!IS_APP || !AppAndroid.drainRecent) return 0;
    let batches = [];
    try { batches = JSON.parse(AppAndroid.drainRecent()); } catch (e) { return 0; }
    const items = [];
    for (const b of batches) for (const x of b) items.push(recentToItem(x));
    if (!items.length) return 0;
    return (await Store.mergePlays(SRC_API, items)).added;
  },

  async recent() {
    if (!SP.loggedIn()) return 0;
    const j = await SP.api('/me/player/recently-played?limit=50');
    const items = (j.items || []).filter(it => it.track).map(it => {
      const tr = it.track;
      const imgs = tr.album && tr.album.images;
      return recentToItem({
        played_at: it.played_at, uri: tr.uri, name: tr.name, duration_ms: tr.duration_ms,
        artist: tr.artists && tr.artists[0] ? tr.artists[0].name : '?',
        album: tr.album ? tr.album.name : '', img: imgs && imgs.length ? (imgs[1] || imgs[0]).url : '',
      });
    });
    const r = await Store.mergePlays(SRC_API, items);
    Store.meta.recent = { last: Date.now() };
    await Store.saveMeta();
    return r.added;
  },

  /** Everything that is set up; quiet=true for automatic runs. */
  async run(opts = {}) {
    if (this.busy) return;
    this.busy = true;
    let added = 0;
    const errors = [];
    try {
      if (Store.meta.demo) return;
      this.setStatus('Синхронизујем…');
      added += await this.drainNative();
      if (SP.loggedIn() && (opts.force || Settings.get('recentAuto'))) {
        try { added += await this.recent(); } catch (e) { errors.push(e.message); }
      }
      if (LF.configured() && (opts.force || Settings.get('lastfmAuto'))) {
        try { added += await LF.sync(t => this.setStatus(t)); } catch (e) { errors.push(e.message); }
      }
    } finally {
      this.busy = false;
      this.lastRun = Date.now();
      this.setStatus(errors.length ? errors[0] : '');
    }
    if (added) App.dataChanged();
    if (opts.report) {
      if (errors.length) toast(errors[0], true);
      else toast(added ? 'Додато ' + countOf(added, 'ново слушање', 'нова слушања', 'нових слушања') : 'Нема нових слушања');
    }
  },
};
