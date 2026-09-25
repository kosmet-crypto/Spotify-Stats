/* ---------- spotifyview.js: the Spotify tab ---------- */

const SpCache = {}; // per-session results (top lists, liked songs, playlists)

Views.spotify = function () {
  const v = h('div.view');
  if (!SP.configured() || !SP.loggedIn()) {
    v.appendChild(card('Повежи Spotify',
      cardNote('Пријава на Spotify омогућава: бележење слушања од сада, твој Spotify топ, лајковане песме, плејлисте, омоте, пуштање песама и прављење плејлиста из статистике.'),
      btn(SP.configured() ? 'Пријави се' : 'Подеси Spotify', () => SP.configured() ? SP.login().catch(e => toast(e.message, true)) : App.openSettings('spotify'))));
    return v;
  }
  const head = h('div.sp-head');
  v.appendChild(head);
  SP.profile().then(me => {
    clear(head);
    const img = me.images && me.images[0] ? h('img.avatar', { src: me.images[0].url, alt: '' }) : h('span.avatar', initials(me.display_name));
    head.appendChild(img);
    head.appendChild(h('div.grow', h('b', me.display_name || me.id), h('div.muted', 'Spotify налог')));
    head.appendChild(btn('Подешавања', () => App.openSettings('spotify'), 'ghost small'));
  }).catch(e => { head.appendChild(h('p.warn', e.message)); });

  v.appendChild(nowPlayingCard());
  v.appendChild(searchCard());
  v.appendChild(spotifyTopCard());
  v.appendChild(likedCard());
  v.appendChild(playlistsCard());
  v.appendChild(generatorCard());
  v.appendChild(libraryCard());
  return v;
};

/* ---------- now playing (A2, A4) ---------- */

function nowPlayingCard() {
  const box = h('div.np');
  const c = card('Сада свира', box);
  let timer = null, last = null;
  const draw = st => {
    last = st;
    clear(box);
    if (!st || !st.item) {
      box.appendChild(h('p.muted', 'Ништа не свира.'));
      box.appendChild(h('div.btn-row', devicesBtn()));
      return;
    }
    const it = st.item;
    const img = it.album && it.album.images && it.album.images.length ? (it.album.images[1] || it.album.images[0]).url : '';
    const artist = (it.artists || []).map(a => a.name).join(', ');
    const localId = Store.trackByKey.get(Store.artistByKey.get(normArtist(it.artists && it.artists[0] ? it.artists[0].name : '')) + '|' + normTitle(it.name));
    const plays = localId !== undefined ? Stats.entityPlays('track', localId).length : 0;
    box.appendChild(h('div.np-main' + (localId !== undefined ? '.click' : ''), { onclick: localId !== undefined ? () => App.openDetail('track', localId) : null },
      h('span.cover.big', img ? h('img', { src: img, alt: '' }) : h('span.cover-txt', initials(it.name))),
      h('div.np-text', h('b', it.name), h('span', artist),
        h('span.muted', plays ? 'Слушао си је ' + countOf(plays, 'пут', 'пута', 'пута') : 'Прво слушање!'),
        st.device ? h('span.muted', '🔈 ' + st.device.name) : null)));
    const prog = h('div.progress', h('span', { style: { width: (it.duration_ms ? (st.progress_ms / it.duration_ms) * 100 : 0) + '%' } }));
    box.appendChild(prog);
    const ctl = (label, fn, cls) => busyBtn(label, async () => { await fn(); setTimeout(poll, 600); }, cls);
    box.appendChild(h('div.np-ctl',
      ctl('⏮', () => SP.api('/me/player/previous', { method: 'POST' }), 'ghost icon'),
      ctl(st.is_playing ? '⏸' : '▶', () => SP.api('/me/player/' + (st.is_playing ? 'pause' : 'play'), { method: 'PUT' }), 'icon'),
      ctl('⏭', () => SP.api('/me/player/next', { method: 'POST' }), 'ghost icon'),
      devicesBtn()));
  };
  const poll = async () => {
    if (!c.isConnected) { clearInterval(timer); return; }
    if (document.hidden) return;
    try { draw(await SP.api('/me/player')); } catch (e) { clear(box); box.appendChild(h('p.warn', e.message)); }
  };
  poll();
  timer = setInterval(poll, 5000);
  return c;
}

function devicesBtn() {
  return busyBtn('Уређаји', async () => {
    const j = await SP.api('/me/player/devices');
    const list = (j && j.devices) || [];
    const body = h('div.sheet-body');
    const close = sheet('Пусти на уређају', body);
    if (!list.length) body.appendChild(empty('Нема активних уређаја. Отвори Spotify на телефону, рачунару или звучнику.'));
    for (const d of list) {
      body.appendChild(h('div.row.click', {
        onclick: async () => {
          try { await SP.api('/me/player', { method: 'PUT', body: { device_ids: [d.id], play: true } }); close(); toast('Пребачено на ' + d.name); }
          catch (e) { toast(e.message, true); }
        },
      }, h('span.row-mid', h('span.row-title', (d.is_active ? '▶ ' : '') + d.name), h('span.row-sub', d.type))));
    }
  }, 'ghost small');
}

/* ---------- search (G1) ---------- */

function searchCard() {
  const q = h('input.search', { type: 'search', placeholder: 'Претражи Spotify…' });
  const out = h('div');
  const run = debounce(async () => {
    const term = q.value.trim();
    clear(out);
    if (term.length < 2) return;
    try {
      const j = await SP.search(term);
      const artists = (j.artists && j.artists.items) || [];
      const tracks = (j.tracks && j.tracks.items) || [];
      if (artists.length) {
        out.appendChild(h('h4', 'Извођачи'));
        out.appendChild(h('div.list', artists.slice(0, 5).map(a => {
          const local = Store.artistByKey.get(normArtist(a.name));
          const n = local !== undefined ? Stats.entityPlays('artist', local).length : 0;
          const img = a.images && a.images.length ? a.images[a.images.length - 1].url : '';
          return h('div.row.click', { onclick: () => local !== undefined ? App.openDetail('artist', local) : openExternal(a.external_urls.spotify) },
            h('span.cover.round', img ? h('img', { src: img, alt: '' }) : h('span.cover-txt', initials(a.name))),
            h('span.row-mid', h('span.row-title', a.name), h('span.row-sub', n ? 'слушао си ' + countOf(n, 'пут', 'пута', 'пута') : 'још ниси слушао')));
        })));
      }
      if (tracks.length) {
        out.appendChild(h('h4', 'Песме'));
        out.appendChild(h('div.list', tracks.map(t => spotifyTrackRow(t))));
      }
      if (!artists.length && !tracks.length) out.appendChild(empty('Ништа није нађено.'));
    } catch (e) { out.appendChild(h('p.warn', e.message)); }
  }, 400);
  q.addEventListener('input', run);
  return card('Претрага', q, out);
}

/** A row for a Spotify API track, with my play count and a play button. */
function spotifyTrackRow(t, extra) {
  const artist = t.artists && t.artists[0] ? t.artists[0].name : '';
  const aId = Store.artistByKey.get(normArtist(artist));
  const local = aId !== undefined ? Store.trackByKey.get(aId + '|' + normTitle(t.name)) : undefined;
  const n = local !== undefined ? Stats.entityPlays('track', local).length : 0;
  const img = t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : '';
  return h('div.row' + (local !== undefined ? '.click' : ''), { onclick: local !== undefined ? () => App.openDetail('track', local) : null },
    extra && extra.rank ? h('span.rank', String(extra.rank)) : null,
    h('span.cover', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(t.name))),
    h('span.row-mid', h('span.row-title', t.name), h('span.row-sub', artist + (extra && extra.sub ? ' · ' + extra.sub : ''))),
    h('span.row-val', n ? fmtInt(n) + '×' : '–'),
    h('button.btn.icon.ghost', {
      type: 'button', title: 'Пусти',
      onclick: async e => { e.stopPropagation(); try { if (await SP.playTrack(t.uri)) toast('Пушта се'); } catch (er) { toast(er.message, true); } },
    }, '▶'));
}

/* ---------- Spotify's own top (A3) with my ranks ---------- */

const TOP_RANGES = [['short_term', '4 недеље', 28], ['medium_term', '6 месеци', 182], ['long_term', 'година', 365]];

function spotifyTopCard() {
  const st = App.sub('sptop', { range: 'short_term', type: 'tracks' });
  const box = h('div');
  const c = card('Твој топ по Spotify-у',
    seg(TOP_RANGES.map(r => [r[0], r[1]]), st.range, r => App.setSub('sptop', { range: r })),
    seg([['tracks', 'Песме'], ['artists', 'Извођачи']], st.type, t => App.setSub('sptop', { type: t })),
    cardNote('Поред сваке: место на твојој листи за исти период (по Слушаоници).'),
    box);
  const key = st.range + st.type;
  const draw = items => {
    clear(box);
    const days = TOP_RANGES.find(r => r[0] === st.range)[2];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [i0, i1] = Stats.range({ from: today.getTime() - (days - 1) * DAY, to: today.getTime() + DAY });
    const kind = st.type === 'tracks' ? 'track' : 'artist';
    const ranks = Stats.rankMap(i0, i1, kind, 'plays');
    box.appendChild(growList(items, (it, k) => {
      let local;
      if (kind === 'track') {
        const aId = Store.artistByKey.get(normArtist(it.artists && it.artists[0] ? it.artists[0].name : ''));
        local = aId !== undefined ? Store.trackByKey.get(aId + '|' + normTitle(it.name)) : undefined;
      } else {
        local = Store.artistByKey.get(normArtist(it.name));
      }
      const mine = local !== undefined ? ranks.get(local) : null;
      const img = kind === 'track' ? (it.album && it.album.images && it.album.images.length ? it.album.images[it.album.images.length - 1].url : '')
        : (it.images && it.images.length ? it.images[it.images.length - 1].url : '');
      return h('div.row' + (local !== undefined ? '.click' : ''), { onclick: local !== undefined ? () => App.openDetail(kind, local) : null },
        h('span.rank', String(k + 1)),
        h('span.cover' + (kind === 'artist' ? '.round' : ''), img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(it.name))),
        h('span.row-mid', h('span.row-title', it.name), kind === 'track' ? h('span.row-sub', (it.artists || []).map(a => a.name).join(', ')) : null),
        h('span.row-val' + (mine ? '' : '.muted'), mine ? 'код мене #' + mine : 'код мене –'));
    }, 20));
  };
  if (SpCache[key]) draw(SpCache[key]);
  else {
    box.appendChild(h('div.spinner'));
    SP.api('/me/top/' + st.type + '?time_range=' + st.range + '&limit=50')
      .then(j => { SpCache[key] = j.items || []; draw(SpCache[key]); })
      .catch(e => { clear(box); box.appendChild(h('p.warn', e.message)); });
  }
  return c;
}

/* ---------- liked songs (B1, B3) ---------- */

function likedCard() {
  const box = h('div');
  const c = card('Лајковане песме', box);
  const draw = () => {
    clear(box);
    const liked = SpCache.liked;
    if (!liked) {
      box.appendChild(cardNote('Колико и када лајкујеш, шта си лајковао а не слушаш, и шта највише слушаш а ниси лајковао.'));
      const status = h('span.muted');
      box.appendChild(h('div.btn-row', busyBtn('Учитај лајковане', async () => {
        SpCache.liked = await SP.all('/me/tracks?limit=50', 20000, (n, total) => { status.textContent = n + ' / ' + (total || '?'); });
        draw();
      }), status));
      return;
    }
    const localOf = it => {
      const t = it.track;
      const aId = Store.artistByKey.get(normArtist(t.artists && t.artists[0] ? t.artists[0].name : ''));
      return aId !== undefined ? Store.trackByKey.get(aId + '|' + normTitle(t.name)) : undefined;
    };
    const counts = liked.map(it => { const l = localOf(it); return l !== undefined ? Stats.entityPlays('track', l).length : 0; });
    const byMonth = new Map();
    for (const it of liked) {
      const d = new Date(it.added_at);
      const k = d.getFullYear() * 12 + d.getMonth();
      byMonth.set(k, (byMonth.get(k) || 0) + 1);
    }
    const ks = [...byMonth.keys()];
    const k0 = Math.min(...ks), k1 = Math.max(...ks);
    const keys = [];
    for (let k = k0; k <= k1; k++) keys.push(k);
    const oldest = liked.reduce((a, b) => (a && a.added_at < b.added_at ? a : b), null);
    box.appendChild(tiles(
      tile('Лајкованих', fmtInt(liked.length)),
      tile('Први лајк', oldest ? fmtDate(Date.parse(oldest.added_at)) : '–', oldest ? oldest.track.name : null),
      tile('Никад слушане', fmtInt(counts.filter(x => x === 0).length)),
    ));
    const el = h('div');
    box.appendChild(h('h4', 'Лајкови по месецима'));
    box.appendChild(el);
    requestAnimationFrame(() => chartSeries(el, {
      labels: keys.map(k => k % 12 === 0 ? String(Math.floor(k / 12)) : MONTHS_SHORT[k % 12]),
      full: keys.map(k => monthKeyLabel(k)), values: keys.map(k => byMonth.get(k) || 0), fmt: x => fmtInt(x) + ' лајкова', color: COLORS[4],
    }));
    const unheard = liked.map((it, i) => ({ it, n: counts[i] })).filter(x => x.n <= 1);
    box.appendChild(h('h4', 'Лајковане, а (скоро) неслушане'));
    box.appendChild(unheard.length ? growList(unheard, x => spotifyTrackRow(x.it.track, { sub: 'лајк ' + fmtDate(Date.parse(x.it.added_at)) }), 10) : empty('Све лајковане слушаш.'));
    // Most played, not liked.
    const likedUris = new Set(liked.map(it => it.track.uri));
    const likedKeys = new Set(liked.map(it => trackKey(it.track.artists && it.track.artists[0] ? it.track.artists[0].name : '', it.track.name)));
    const top = Stats.top(0, Stats.cols().n, 'track').filter(x => {
      const t = Store.tracks[x.id];
      return !(t.uri && likedUris.has(t.uri)) && !likedKeys.has(trackKey(Store.artists[t.a].n, t.n));
    }).slice(0, 50);
    box.appendChild(h('h4', 'Највише слушаш, а ниси лајковао'));
    box.appendChild(growList(top, (x, k) => {
      const heart = busyBtn('♡', async () => {
        const uri = await SP.resolveTrack(x.id);
        if (!uri) { toast('Није нађено на Spotify-у', true); return; }
        await SP.save([uri], true);
        heart.textContent = '♥';
        heart.disabled = true;
        toast('Лајковано');
      }, 'ghost icon');
      const r = entityRow('track', x, k + 1, top[0].plays, 'plays');
      r.appendChild(heart);
      heart.addEventListener('click', e => e.stopPropagation());
      return r;
    }, 10));
  };
  draw();
  return c;
}

/* ---------- playlists (V1) ---------- */

async function myPlaylists(force) {
  if (!SpCache.playlists || force) {
    const me = await SP.profile();
    const all = await SP.all('/me/playlists?limit=50', 2000);
    SpCache.playlists = all.filter(Boolean).map(p => Object.assign(p, { mine: p.owner && p.owner.id === me.id }));
  }
  return SpCache.playlists;
}
function playlistCount(p) {
  const x = p.items || p.tracks;
  return x && x.total != null ? x.total : null;
}

function playlistsCard() {
  const box = h('div');
  const c = card('Плејлисте', box);
  const draw = list => {
    clear(box);
    const mine = list.filter(p => p.mine);
    box.appendChild(cardNote(countOf(list.length, 'плејлиста', 'плејлисте', 'плејлиста') + ', твојих ' + mine.length + '. Тапни своју плејлисту да видиш колико слушаш њене песме.'));
    box.appendChild(growList(list, p => {
      const img = p.images && p.images.length ? p.images[p.images.length - 1].url : '';
      const n = playlistCount(p);
      return h('div.row.click', { onclick: () => p.mine ? App.openOverlay(p.name, () => playlistView(p)) : openExternal(p.external_urls && p.external_urls.spotify) },
        h('span.cover', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(p.name))),
        h('span.row-mid', h('span.row-title', p.name), h('span.row-sub', (p.mine ? 'твоја' : 'прати: ' + (p.owner ? p.owner.display_name : '')) + (n != null ? ' · ' + countOf(n, 'песма', 'песме', 'песама') : ''))));
    }, 15));
  };
  if (SpCache.playlists) draw(SpCache.playlists);
  else box.appendChild(busyBtn('Учитај плејлисте', async () => draw(await myPlaylists()), 'ghost'));
  return c;
}

function playlistView(p) {
  const v = h('div.view');
  const box = h('div');
  v.appendChild(box);
  box.appendChild(h('div.spinner'));
  (async () => {
    const items = await SP.all('/playlists/' + p.id + '/items?limit=50', 10000);
    const tracks = items.map(it => it.item || it.track).filter(t => t && t.type === 'track' && t.uri);
    clear(box);
    const withCounts = tracks.map((t, k) => {
      const aId = Store.artistByKey.get(normArtist(t.artists && t.artists[0] ? t.artists[0].name : ''));
      const local = aId !== undefined ? Store.trackByKey.get(aId + '|' + normTitle(t.name)) : undefined;
      return { t, k, n: local !== undefined ? Stats.entityPlays('track', local).length : 0 };
    });
    const unheard = withCounts.filter(x => !x.n).length;
    box.appendChild(tiles(tile('Песама', fmtInt(tracks.length)), tile('Слушања укупно', fmtInt(withCounts.reduce((a, b) => a + b.n, 0))), tile('Никад слушане', fmtInt(unheard))));
    box.appendChild(h('div.btn-row',
      btn('Отвори у Spotify-у', () => openExternal(p.external_urls && p.external_urls.spotify), 'ghost'),
      btn('Сложи по мојим слушањима', () => confirmSheet('Сложи плејлисту', 'Песме у „' + p.name + '“ биће поређане од највише ка најмање слушаним. Наставити?', 'Сложи', async () => {
        const sorted = withCounts.slice().sort((a, b) => b.n - a.n || a.k - b.k).map(x => x.t.uri);
        await replacePlaylist(p.id, sorted);
        toast('Плејлиста је сложена');
        App.back();
      }), 'ghost')));
    box.appendChild(card(null, growList(withCounts, x => spotifyTrackRow(x.t, { rank: x.k + 1 }), 50)));
  })().catch(e => { clear(box); box.appendChild(h('p.warn', e.message)); });
  return v;
}

async function replacePlaylist(id, uris) {
  await SP.api('/playlists/' + id + '/items', { method: 'PUT', body: { uris: uris.slice(0, 100) } });
  for (let i = 100; i < uris.length; i += 100) {
    await SP.api('/playlists/' + id + '/items', { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  }
}

/* ---------- playlist from stats (V2, V3, V4) ---------- */

const GEN_SOURCES = [
  ['top', 'Топ песме периода'],
  ['new', 'Откривања периода'],
  ['obs', 'Опсесије периода'],
  ['comeback', 'Повратници'],
  ['forgotten', 'Заборављени фаворити'],
  ['morning', 'Јутарња музика (6–11ч)'],
  ['night', 'Ноћна музика (22–4ч)'],
];

function generatorTracks(source, n) {
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  let ids;
  if (source === 'top') ids = Stats.top(i0, i1, 'track').map(x => x.id);
  else if (source === 'new') ids = Stats.discoveries(i0, i1).newTracks.map(x => x.id);
  else if (source === 'obs') ids = Stats.obsessions(i0, i1).map(x => x.id);
  else if (source === 'comeback') ids = Stats.comebacks(i0, i1).map(x => x.id);
  else if (source === 'forgotten') ids = forgottenFavorites().map(x => x.id);
  else {
    const c = Stats.cols();
    const test = source === 'morning' ? i => c.HOUR[i] >= 6 && c.HOUR[i] < 11 : i => c.HOUR[i] >= 22 || c.HOUR[i] < 4;
    ids = Stats.top(i0, i1, 'track', 'plays', { key: source, test }).map(x => x.id);
  }
  return [...new Set(ids)].slice(0, n);
}

function generatorCard() {
  const P = App.range();
  const src = h('select', GEN_SOURCES.map(([v, l]) => h('option', { value: v }, l)));
  const count = h('select', [25, 50, 100, 200].map(n => h('option', { value: n, selected: n === 50 }, String(n))));
  const name = h('input', { type: 'text' });
  const target = h('select', h('option', { value: '' }, 'нова плејлиста'));
  const coverChk = h('input', { type: 'checkbox', checked: true });
  const setName = () => {
    const label = GEN_SOURCES.find(x => x[0] === src.value)[1].replace(' периода', '');
    name.value = label + ' · ' + resolvePeriod(App.period).short;
  };
  src.addEventListener('change', setName);
  setName();
  if (SpCache.playlists) {
    for (const p of SpCache.playlists.filter(p => p.mine)) target.appendChild(h('option', { value: p.id }, 'замени: ' + p.name));
  }
  const status = h('p.muted');
  return card('Направи плејлисту из статистике',
    cardNote('Песме по избору за период „' + P.label + '“. Песме без Spotify линка (из Last.fm-а) траже се претрагом.'),
    h('div.field', h('label', 'Шта'), src),
    h('div.field', h('label', 'Колико песама'), count),
    h('div.field', h('label', 'Назив'), name),
    h('div.field', h('label', 'Куда'), target, SpCache.playlists ? null : h('span.muted', ' (учитај плејлисте да би могао да замениш постојећу)')),
    h('label.check', coverChk, ' Направи омот плејлисте'),
    busyBtn('Направи', async () => {
      const ids = generatorTracks(src.value, +count.value);
      if (!ids.length) { toast('Нема песама за тај избор у овом периоду', true); return; }
      const uris = [];
      for (let k = 0; k < ids.length; k++) {
        status.textContent = 'Тражим песме на Spotify-у: ' + (k + 1) + ' / ' + ids.length;
        try { const u = await SP.resolveTrack(ids[k]); if (u) uris.push(u); } catch (e) { if (e.reason === 'offline') throw e; }
      }
      status.textContent = 'Правим плејлисту…';
      let id = target.value, url;
      if (!id) {
        const pl = await SP.api('/me/playlists', { method: 'POST', body: { name: name.value || 'Слушаоница', description: 'Направљено у Слушаоници (' + P.label + ')', public: false } });
        id = pl.id; url = pl.external_urls && pl.external_urls.spotify;
        SpCache.playlists = null;
      }
      await replacePlaylist(id, uris);
      if (coverChk.checked) {
        try {
          const jpg = await playlistCoverJpeg(name.value || 'Слушаоница', P.label);
          await SP.api('/playlists/' + id + '/images', { method: 'PUT', raw: jpg, contentType: 'image/jpeg' });
        } catch (e) { console.warn('cover', e); }
      }
      status.textContent = 'Готово: ' + countOf(uris.length, 'песма', 'песме', 'песама') + '.';
      toast('Плејлиста је спремна');
      if (url) openExternal(url);
    }), status);
}

/** A generated 640×640 JPEG cover (base64, no data: prefix) for playlists made here. */
async function playlistCoverJpeg(title, sub) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 640;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 640);
  grad.addColorStop(0, '#1c5cab');
  grad.addColorStop(1, '#199e70');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 640);
  g.fillStyle = 'rgba(255,255,255,.12)';
  for (let k = 0; k < 7; k++) g.fillRect(60 + k * 76, 520 - (k * 53 % 190) - 60, 44, (k * 53 % 190) + 60);
  g.fillStyle = '#fff';
  g.font = '700 58px system-ui, sans-serif';
  const words = title.split(' ');
  let line = '', y = 130;
  for (const w of words) {
    if (g.measureText(line + w).width > 540 && line) { g.fillText(line.trim(), 50, y); y += 68; line = ''; }
    line += w + ' ';
  }
  g.fillText(line.trim(), 50, y);
  g.font = '500 30px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText(sub, 50, y + 54);
  g.fillText('Слушаоница', 50, 600);
  let q = 0.9, data;
  do { data = cv.toDataURL('image/jpeg', q).split(',')[1]; q -= 0.15; } while (data.length > 250000 && q > 0.3);
  return data;
}

/* ---------- saved albums and followed artists (B2) ---------- */

function libraryCard() {
  const box = h('div');
  const c = card('Библиотека', box);
  const draw = () => {
    clear(box);
    if (!SpCache.albums) {
      box.appendChild(cardNote('Сачувани албуми и извођачи које пратиш, са твојим слушањима.'));
      box.appendChild(busyBtn('Учитај библиотеку', async () => {
        const [albums, artists] = await Promise.all([
          SP.all('/me/albums?limit=50', 5000).catch(() => []),
          SP.all('/me/following?type=artist&limit=50', 5000).catch(() => []),
        ]);
        SpCache.albums = albums; SpCache.following = artists;
        draw();
      }, 'ghost'));
      return;
    }
    const followed = SpCache.following.map(a => {
      const local = Store.artistByKey.get(normArtist(a.name));
      return { a, local, n: local !== undefined ? Stats.entityPlays('artist', local).length : 0 };
    }).sort((x, y) => y.n - x.n);
    box.appendChild(tiles(tile('Сачуваних албума', fmtInt(SpCache.albums.length)), tile('Пратиш извођача', fmtInt(followed.length)),
      tile('Пратиш, а не слушаш', fmtInt(followed.filter(x => x.n === 0).length))));
    box.appendChild(h('h4', 'Извођачи које пратиш'));
    box.appendChild(growList(followed, x => {
      const img = x.a.images && x.a.images.length ? x.a.images[x.a.images.length - 1].url : '';
      return h('div.row' + (x.local !== undefined ? '.click' : ''), { onclick: x.local !== undefined ? () => App.openDetail('artist', x.local) : null },
        h('span.cover.round', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(x.a.name))),
        h('span.row-mid', h('span.row-title', x.a.name)), h('span.row-val' + (x.n ? '' : '.muted'), x.n ? fmtInt(x.n) + '×' : 'не слушаш'));
    }, 10));
    box.appendChild(h('h4', 'Сачувани албуми'));
    box.appendChild(growList(SpCache.albums.map(it => it.album).filter(Boolean), al => {
      const img = al.images && al.images.length ? al.images[al.images.length - 1].url : '';
      return h('div.row.click', { onclick: () => openExternal(al.external_urls && al.external_urls.spotify) },
        h('span.cover', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(al.name))),
        h('span.row-mid', h('span.row-title', al.name), h('span.row-sub', (al.artists || []).map(a => a.name).join(', ') + ' · ' + (al.release_date || '').slice(0, 4))));
    }, 10));
  };
  draw();
  return c;
}
