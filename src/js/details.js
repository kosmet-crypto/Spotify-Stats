/* ---------- details.js: song / artist / album / day pages, the "Wrapped" summary, artist groups ---------- */

/** Monthly plays of one entity over its whole history. */
function entityMonthly(kind, id) {
  const c = Stats.cols(), idx = Stats.entityPlays(kind, id);
  if (!idx.length) return null;
  const k0 = monthKeyOfDay(c.DAY[idx[0]]), k1 = monthKeyOfDay(c.DAY[idx[idx.length - 1]]);
  const vals = new Array(k1 - k0 + 1).fill(0);
  for (const i of idx) vals[monthKeyOfDay(c.DAY[i]) - k0] += c.CNT[i];
  const keys = vals.map((x, j) => k0 + j);
  return {
    values: vals, labels: keys.map(k => monthKeyLabel(k)),
    short: keys.map(k => k % 12 === 0 ? String(Math.floor(k / 12)) : MONTHS_SHORT[k % 12]),
  };
}

function entityTotals(kind, id, i0, i1) {
  const c = Stats.cols(), idx = Stats.entityPlays(kind, id);
  let plays = 0, ms = 0, pPlays = 0, pMs = 0, json = 0, skip = 0;
  const fwd = Store.reasons.indexOf('fwdbtn');
  const hours = new Array(24).fill(0);
  const days = new Map();
  for (const i of idx) {
    plays += c.CNT[i]; ms += c.MS[i];
    if (i >= i0 && i < i1) { pPlays += c.CNT[i]; pMs += c.MS[i]; }
    hours[c.HOUR[i]] += c.CNT[i];
    if (c.CNT[i]) days.set(c.DAY[i], (days.get(c.DAY[i]) || 0) + 1);
    if (c.F[i] & SRC_JSON) { json++; if ((c.F[i] & F_SKIPPED) || (fwd > 0 && c.RE[i] === fwd)) skip++; }
  }
  let firstI = -1, lastI = -1;
  for (const i of idx) if (c.CNT[i]) { if (firstI < 0) firstI = i; lastI = i; }
  const topDays = [...days].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    plays, ms, pPlays, pMs, json, skip, hours, topDays, daysCount: days.size,
    first: firstI >= 0 ? c.T[firstI] : 0, last: lastI >= 0 ? c.T[lastI] : 0,
  };
}

function detailActions(trackId) {
  const t = Store.tracks[trackId];
  const row_ = h('div.actions');
  row_.appendChild(busyBtn('▶ Пусти', async () => {
    if (!SP.loggedIn()) { const u = t.uri; if (u) openExternal(spotifyOpenUrl(u)); else toast('Повежи Spotify у подешавањима', true); return; }
    const uri = await SP.resolveTrack(trackId);
    if (!uri) { toast('Песма није нађена на Spotify-у', true); return; }
    if (await SP.playTrack(uri)) toast('Пушта се');
  }));
  row_.appendChild(busyBtn('Отвори у Spotify-у', async () => {
    const uri = t.uri || (SP.loggedIn() ? await SP.resolveTrack(trackId) : null);
    openExternal(uri ? spotifyOpenUrl(uri) : 'https://open.spotify.com/search/' + encodeURIComponent(t.n + ' ' + Store.artists[t.a].n));
  }, 'ghost'));
  if (SP.loggedIn()) {
    const heart = busyBtn('♡', async () => {
      const uri = await SP.resolveTrack(trackId);
      if (!uri) return;
      const on = heart.dataset.on !== '1';
      await SP.save([uri], on);
      heart.dataset.on = on ? '1' : '0';
      heart.textContent = on ? '♥' : '♡';
      toast(on ? 'Додато у лајковане' : 'Уклоњено из лајкованих');
    }, 'ghost icon-text');
    heart.title = 'Лајкуј на Spotify-у';
    if (t.uri) SP.isSaved([t.uri]).then(r => { if (r[0]) { heart.dataset.on = '1'; heart.textContent = '♥'; } }).catch(() => {});
    row_.appendChild(heart);
  }
  return row_;
}

function detailCommon(kind, id, v) {
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const tt = entityTotals(kind, id, i0, i1);
  const rank = Stats.rankMap(i0, i1, kind, 'plays').get(id);
  const rankAll = Stats.rankMap(0, Stats.cols().n, kind, 'plays').get(id);
  v.appendChild(tiles(
    tile('Слушања укупно', fmtInt(tt.plays), fmtDur(tt.ms)),
    tile('У периоду', fmtInt(tt.pPlays), P.label),
    tile('Место', rank ? '#' + rank : '–', rankAll ? 'свих времена #' + rankAll : null),
    tile('Први пут', fmtDate(tt.first)),
    tile('Последњи пут', fmtDate(tt.last)),
    tt.json >= 5 ? tile('Прескочено', fmtPct(tt.skip / tt.json)) : tile('Дана са слушањем', fmtInt(tt.daysCount)),
  ));
  const m = entityMonthly(kind, id);
  if (m && m.values.length > 1) {
    const el = h('div');
    v.appendChild(card('Слушања по месецима', el));
    requestAnimationFrame(() => chartSeries(el, { labels: m.short, full: m.labels, values: m.values, fmt: x => countOf(x, 'слушање', 'слушања', 'слушања') }));
  }
  const ms = Stats.milestones(kind, id);
  if (ms.length > 1) {
    v.appendChild(card('Прекретнице', h('div.list', ms.map(x => row({ title: x.n + '. слушање', value: fmtDate(x.t) })))));
  }
  const hrEl = h('div');
  v.appendChild(card('У које доба дана', hrEl));
  chartHBars(hrEl, tt.hours.map((x, hh) => ({ label: String(hh).padStart(2, '0') + ':00', value: x })), fmtInt, COLORS[2]);
  if (tt.topDays.length) {
    v.appendChild(card('Највише у једном дану', h('div.list', tt.topDays.map(([d, n]) => row({
      title: WEEKDAYS[weekdayOfDay(d)] + ', ' + fmtDay(d), value: countOf(n, 'пут', 'пута', 'пута'), onClick: () => App.openDay(d),
    })))));
  }
}

function trackDetail(id) {
  const t = Store.tracks[id];
  const v = h('div.view');
  v.appendChild(h('div.detail-head', cover('track', id, 96), h('div',
    h('h2', cleanTitle(t.n)),
    h('a.link', { href: '#', onclick: e => { e.preventDefault(); App.openDetail('artist', t.a); } }, Store.artists[t.a].n),
    t.al >= 0 ? h('a.link.muted', { href: '#', onclick: e => { e.preventDefault(); App.openDetail('album', t.al); } }, Store.albums[t.al].n) : null,
    t.dur ? h('div.muted', fmtClock(t.dur)) : null)));
  v.appendChild(detailActions(id));
  detailCommon('track', id, v);
  return v;
}

function artistDetail(id) {
  const a = Store.artists[id];
  const v = h('div.view');
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  v.appendChild(h('div.detail-head', cover('artist', id, 96), h('div', h('h2', a.n), tagChips(id))));
  detailCommon('artist', id, v);
  const c = Stats.cols();
  const filter = { key: 'ar' + id, test: i => c.AR[i] === id };
  const all = Stats.top(0, c.n, 'track', 'plays', filter);
  const per = Stats.top(i0, i1, 'track', 'plays', filter);
  const list = per.length ? per : all;
  if (list.length) {
    const max = list[0].plays;
    v.appendChild(card('Песме' + (per.length ? ' (' + P.label + ')' : ''), growList(list, (x, k) => entityRow('track', x, k + 1, max, 'plays'), 15)));
  }
  const albums = Stats.top(0, c.n, 'album', 'plays', filter);
  if (albums.length) {
    const max = albums[0].plays;
    v.appendChild(card('Албуми', growList(albums, (x, k) => entityRow('album', x, k + 1, max, 'plays'), 10)));
  }
  if (SP.loggedIn()) {
    const box = h('div');
    v.appendChild(card('На Spotify-у', box));
    box.appendChild(busyBtn('Прикажи албуме и синглове', async () => {
      const sid = await artistSpotifyId(id);
      if (!sid) { toast('Извођач није нађен на Spotify-у', true); return; }
      const j = await SP.api('/artists/' + sid + '/albums?include_groups=album,single&limit=50');
      clear(box);
      const known = new Set(Store.albums.map((al, k) => al.a === id ? foldText(al.n) : null).filter(Boolean));
      box.appendChild(h('div.list', (j.items || []).map(al => {
        const img = al.images && al.images.length ? (al.images[al.images.length > 1 ? 1 : 0]).url : '';
        const heard = known.has(foldText(al.name));
        return h('div.row.click', { onclick: () => openExternal(al.external_urls && al.external_urls.spotify) },
          h('span.cover', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.cover-txt', initials(al.name))),
          h('span.row-mid', h('span.row-title', al.name), h('span.row-sub', (al.release_date || '').slice(0, 4) + ' · ' + (al.album_type === 'single' ? 'сингл' : 'албум'))),
          h('span.row-val' + (heard ? '' : '.muted'), heard ? 'слушао' : 'ново'));
      })));
    }, 'ghost wide'));
  }
  return v;
}

async function artistSpotifyId(id) {
  const a = Store.artists[id];
  if (a.sid) return a.sid;
  const tr = Store.tracks.findIndex(t => t.a === id && t.uri);
  if (tr >= 0) {
    const j = await SP.api('/tracks/' + spotifyIdFromUri(Store.tracks[tr].uri));
    if (j.artists && j.artists[0]) { a.sid = j.artists[0].id; Covers.dirty(); return a.sid; }
  }
  const r = await SP.api('/search?' + new URLSearchParams({ q: a.n, type: 'artist', limit: '5' }));
  const hit = r.artists && r.artists.items.find(x => normArtist(x.name) === normArtist(a.n));
  if (hit) { a.sid = hit.id; Covers.dirty(); }
  return a.sid || null;
}

function albumDetail(id) {
  const al = Store.albums[id];
  const v = h('div.view');
  const c = Stats.cols();
  v.appendChild(h('div.detail-head', cover('album', id, 96), h('div', h('h2', al.n),
    h('a.link', { href: '#', onclick: e => { e.preventDefault(); App.openDetail('artist', al.a); } }, Store.artists[al.a].n))));
  const filter = { key: 'al' + id, test: i => c.AL[i] === id };
  const list = Stats.top(0, c.n, 'track', 'plays', filter);
  const tot = list.reduce((a, b) => a + b.plays, 0), ms = list.reduce((a, b) => a + b.ms, 0);
  v.appendChild(tiles(tile('Слушања', fmtInt(tot)), tile('Време', fmtDur(ms)), tile('Песама', fmtInt(list.length))));
  if (list.length) {
    const max = list[0].plays;
    v.appendChild(card('Песме', h('div.list', list.map((x, k) => entityRow('track', x, k + 1, max, 'plays')))));
  }
  return v;
}

function dayDetail(day) {
  const c = Stats.cols();
  const from = dayStart(day), to = dayStart(day + 1);
  const i0 = lowerBound(c.T, from - 6 * 3600000), i1 = lowerBound(c.T, to + 6 * 3600000);
  const v = h('div.view');
  const rows = [];
  let ms = 0, plays = 0;
  for (let i = i0; i < i1; i++) {
    if (c.DAY[i] !== day) continue;
    ms += c.MS[i]; plays += c.CNT[i];
    const d = new Date(c.T[i]);
    const tid = c.TR[i];
    rows.push(row({
      title: entityName('track', tid), sub: entitySub('track', tid) + (c.CNT[i] ? '' : ' · прескочено'),
      value: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      kind: 'track', id: tid, onClick: () => App.openDetail('track', tid),
    }));
  }
  v.appendChild(tiles(tile('Слушања', fmtInt(plays)), tile('Време', fmtDur(ms))));
  v.appendChild(card(null, rows.length ? growList(rows, r => r, 60) : empty('Тог дана ниси слушао музику.')));
  return v;
}

/* ---------- "Wrapped" for any period ---------- */

function wrappedView() {
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const v = h('div.view.wrapped');
  const t = Stats.totals(i0, i1);
  if (!t.all) { v.appendChild(empty('Нема слушања у овом периоду.')); return v; }
  const topT = Stats.top(i0, i1, 'track').slice(0, 5);
  const topA = Stats.top(i0, i1, 'artist').slice(0, 5);
  const topAl = Stats.top(i0, i1, 'album').slice(0, 3);
  const rec = Stats.records(i0, i1);
  const disc = Stats.discoveries(i0, i1);
  const sk = Stats.streaks(i0, i1);
  const obs = Stats.obsessions(i0, i1);
  const slide = (cls, ...kids) => h('section.slide.' + cls, kids);
  v.appendChild(slide('s1', h('p', 'Твоја музика, ' + P.label), h('div.big', fmtInt(t.ms / 60000)), h('p', 'минута слушања'),
    h('p.small', countOf(t.plays, 'слушање', 'слушања', 'слушања') + ' · ' + countOf(t.tracks, 'песма', 'песме', 'песама') + ' · ' + countOf(t.artists, 'извођач', 'извођача', 'извођача'))));
  if (topT.length) {
    v.appendChild(slide('s2', h('p', 'Песма периода'), cover('track', topT[0].id, 150), h('h2', entityName('track', topT[0].id)),
      h('p', entitySub('track', topT[0].id) + ' · ' + countOf(topT[0].plays, 'пут', 'пута', 'пута')),
      h('ol', topT.slice(1).map(x => h('li', entityName('track', x.id) + ' — ' + entitySub('track', x.id))))));
  }
  if (topA.length) {
    v.appendChild(slide('s3', h('p', 'Извођач периода'), cover('artist', topA[0].id, 150), h('h2', entityName('artist', topA[0].id)),
      h('p', fmtDur(topA[0].ms) + ' слушања'),
      h('ol', topA.slice(1).map(x => h('li', entityName('artist', x.id))))));
  }
  if (topAl.length) {
    v.appendChild(slide('s4', h('p', 'Албум периода'), cover('album', topAl[0].id, 120), h('h2', entityName('album', topAl[0].id)), h('p', entitySub('album', topAl[0].id))));
  }
  v.appendChild(slide('s5', h('p', 'Кад си највише слушао'),
    rec.bestMonth ? h('h3', 'Месец: ' + rec.bestMonth.label) : null,
    h('h3', 'Дан у недељи: ' + WEEKDAYS[rec.bestWeekday]),
    h('h3', 'Сат: ' + rec.bestHour + ':00'),
    rec.topDays[0] ? h('p', 'Рекордни дан: ' + fmtDay(rec.topDays[0].day) + ' — ' + fmtDur(rec.topDays[0].ms)) : null,
    h('p', 'Најдужи низ: ' + countOf(sk.best.len, 'дан', 'дана', 'дана') + ' заредом')));
  v.appendChild(slide('s6', h('p', 'Откривања'), h('div.big', fmtInt(disc.newArtists.length)), h('p', 'нових извођача'),
    disc.newArtists[0] ? h('p', 'Највеће откриће: ' + entityName('artist', disc.newArtists[0].id)) : null,
    h('p.small', countOf(disc.newTracks.length, 'нова песма', 'нове песме', 'нових песама'))));
  if (rec.repeat.n > 2) {
    v.appendChild(slide('s7', h('p', 'На репиту'), h('h2', entityName('track', rec.repeat.id)),
      h('p', countOf(rec.repeat.n, 'пут', 'пута', 'пута') + ' у једном дану (' + fmtDay(rec.repeat.day) + ')'),
      obs[0] ? h('p.small', 'Највећа опсесија: ' + entityName('track', obs[0].id) + ' — ' + obs[0].peak + '× за 30 дана') : null));
  }
  return v;
}

/* ---------- artist groups ---------- */

function tagChips(artistId) {
  const a = Store.artists[artistId];
  const wrap = h('div.tagchips');
  const draw = () => {
    clear(wrap);
    for (const tg of Settings.get('tagNames')) {
      const on = (a.tags || []).includes(tg);
      wrap.appendChild(h('button.chip.small' + (on ? '.on' : ''), {
        type: 'button', onclick: async () => {
          a.tags = on ? a.tags.filter(x => x !== tg) : (a.tags || []).concat([tg]);
          await Store.saveDict();
          Stats.cache.clear();
          draw();
        },
      }, (on ? '✓ ' : '+ ') + tg));
    }
  };
  draw();
  return wrap;
}

/** Quick tagging of the most played artists. */
function taggerView() {
  const v = h('div.view');
  const tags = Settings.get('tagNames');
  v.appendChild(cardNote('Тапни групу поред извођача. Групе (нпр. ExYu, Рок, Домаће) додајеш у подешавањима → „Групе извођача“.'));
  const top = Stats.top(0, Stats.cols().n, 'artist');
  const q = h('input.search', { type: 'search', placeholder: 'Претражи извођаче…' });
  const list = h('div');
  const draw = () => {
    clear(list);
    const term = foldText(q.value.trim());
    const items = term ? top.filter(x => foldText(Store.artists[x.id].n).includes(term)) : top;
    list.appendChild(growList(items, (x, k) => h('div.row',
      cover('artist', x.id, 36),
      h('span.row-mid', h('span.row-title', Store.artists[x.id].n), h('span.row-sub', countOf(x.plays, 'слушање', 'слушања', 'слушања'))),
      tagChips(x.id)), 40));
  };
  q.addEventListener('input', debounce(draw, 200));
  v.appendChild(card(null, tags.length ? null : cardNote('Нема група. Додај их у подешавањима.'), q, list));
  draw();
  return v;
}
