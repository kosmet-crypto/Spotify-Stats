/* ---------- views.js: the main tabs (Преглед, Време, Топ, Анализа) ---------- */

const Views = {};

/* ---------- welcome (no data yet) ---------- */

function welcomeView() {
  return h('div.view',
    h('div.hero-welcome',
      h('h1', 'Слушаоница'),
      h('p', 'Твоја статистика слушања музике: по данима, месецима и годинама, са пуно графикона. Сви подаци остају на телефону.')),
    card('1. Цела историја: Spotify извоз',
      cardNote('Spotify на захтев шаље сва твоја слушања од отварања налога („Extended streaming history“). Стиже мејлом за неколико дана (највише 30). Када стигне, увези ZIP или JSON фајлове овде.'),
      h('ol.steps',
        h('li', 'spotify.com → Account → Privacy settings'),
        h('li', 'Download your data → штиклирај „Extended streaming history“ → Request data'),
        h('li', 'Потврди мејл, сачекај мејл са фајлом, преузми ZIP')),
      h('div.btn-row',
        btn('Отвори Spotify подешавања', () => openExternal('https://www.spotify.com/account/privacy/'), 'ghost'),
        importButton('Увези ZIP / JSON'))),
    card('2. Од сада: Spotify пријава',
      cardNote('Апликација бележи шта слушаш (Spotify памти само последњих 50 песама, зато их Слушаоница редовно преузима, и у позадини на Android-у). Ту су и твој Spotify топ, лајковане песме, плејлисте и управљање репродукцијом.'),
      btn('Повежи Spotify', () => App.openSettings('spotify'))),
    card('3. Опционо: Last.fm',
      cardNote('Ако Spotify скроблујеш на Last.fm, Слушаоница преузима целу ту историју и попуњава рупе док не стигне извоз. Дупла слушања се спајају аутоматски.'),
      btn('Повежи Last.fm', () => App.openSettings('lastfm'), 'ghost')),
    card('Само да погледаш?',
      cardNote('Пробни подаци (измишљени извођачи, 6 година слушања) да видиш све графиконе одмах. Бришу се чим увезеш своје податке.'),
      busyBtn('Учитај пробне податке', async () => { await loadDemo(); App.dataChanged(); }, 'ghost')));
}

function importButton(label) {
  const input = h('input', { type: 'file', multiple: true, accept: '.zip,.json,application/zip,application/json', style: { display: 'none' } });
  const b = busyBtn(label, async () => { input.value = ''; input.click(); });
  input.addEventListener('change', () => runImport([...input.files]));
  return h('span', b, input);
}
async function runImport(files) {
  if (!files.length) return;
  const status = h('p.note', 'Почињем…');
  const close = sheet('Увоз Spotify историје', h('div.sheet-body', h('div.spinner'), status));
  try {
    if (Store.meta.demo) await Store.wipe();
    const r = await importSpotifyFiles(files, t => { status.textContent = t; });
    close();
    App.dataChanged();
    sheet('Увоз је готов', h('div.sheet-body',
      h('p', 'Прочитано ' + countOf(r.total, 'слушање', 'слушања', 'слушања') + ' из ' + countOf(r.files, 'фајла', 'фајла', 'фајлова') + '.'),
      h('p', 'Ново: ' + fmtInt(r.added) + (r.skipped ? ', већ унето: ' + fmtInt(r.skipped) : '') + (r.podcasts ? ', подкаста прескочено: ' + fmtInt(r.podcasts) : '') + '.'),
      r.extended ? null : h('p.warn', 'Ово је кратка историја (само последња година, без прескакања и платформи). За све податке затражи „Extended streaming history“.')));
  } catch (e) {
    console.error(e);
    close();
    toast(e.message || String(e), true);
  }
}

/* ---------- Преглед ---------- */

Views.overview = function () {
  if (Store.isEmpty()) return welcomeView();
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const v = h('div.view');
  if (Store.meta.demo) {
    v.appendChild(h('div.banner', h('span', 'Пробни подаци. Увези своје да их замениш.'),
      busyBtn('Обриши', async () => { await Store.wipe(); App.dataChanged(); }, 'small ghost')));
  }
  const t = Stats.totals(i0, i1);
  if (!t.all) {
    v.appendChild(empty('Нема слушања у периоду „' + P.label + '“.'));
    return v;
  }
  v.appendChild(h('div.hero',
    h('div.hero-label', 'Слушао си ' + P.label),
    h('div.hero-value', fmtHours(t.ms), h('small', ' сати')),
    h('div.hero-sub', fmtInt(t.ms / 60000) + ' минута · ' + countOf(t.plays, 'слушање', 'слушања', 'слушања'))));
  const avgDay = t.spanDays ? t.ms / t.spanDays : 0;
  v.appendChild(tiles(
    tile('Песама', fmtInt(t.tracks)),
    tile('Извођача', fmtInt(t.artists)),
    tile('Албума', fmtInt(t.albums)),
    tile('Дневно у просеку', fmtDur(avgDay)),
    tile('Дана са музиком', fmtInt(t.activeDays), t.spanDays ? 'од ' + fmtInt(t.spanDays) + ' (' + fmtPct(t.activeDays / t.spanDays) + ')' : null),
    tile('Најдужи низ', countOf(Stats.streaks(i0, i1).best.len, 'дан', 'дана', 'дана')),
  ));
  if (t.estimated > t.all * 0.2) {
    v.appendChild(cardNote('Део минута је процена: Last.fm и Spotify „недавно слушано“ не кажу колико је песма трајала, па се рачуна њена дужина.'));
  }
  const bucket = autoBucket(i0, i1);
  const ser = Stats.series(i0, i1, bucket);
  const chartEl = h('div');
  v.appendChild(card('Минути по ' + { day: 'данима', week: 'недељама', month: 'месецима', year: 'годинама' }[bucket], chartEl));
  requestAnimationFrame(() => chartSeries(chartEl, {
    labels: ser.short, full: ser.labels, values: ser.ms.map(x => x / 60000), fmt: x => fmtInt(x) + ' мин',
  }));

  const topT = Stats.top(i0, i1, 'track').slice(0, 5);
  const topA = Stats.top(i0, i1, 'artist').slice(0, 5);
  v.appendChild(card('Топ песме', h('div.list', topT.map((x, k) => entityRow('track', x, k + 1, topT[0].plays, 'plays'))),
    btn('Све песме →', () => App.go('top', { kind: 'track' }), 'ghost wide')));
  v.appendChild(card('Топ извођачи', h('div.list', topA.map((x, k) => entityRow('artist', x, k + 1, topA[0].plays, 'plays'))),
    btn('Сви извођачи →', () => App.go('top', { kind: 'artist' }), 'ghost wide')));
  v.appendChild(h('button.wrapped-btn', { type: 'button', onclick: () => App.openWrapped() },
    h('b', 'Мој преглед за „' + P.label + '“'), h('span', 'Највећи хитови, рекорди и откривања, као Spotify Wrapped →')));
  v.appendChild(sourcesNote());
  return v;
};

function sourcesNote() {
  const parts = [];
  if (Store.coverage.length) parts.push('Spotify извоз до ' + fmtDate(Store.coverage[Store.coverage.length - 1][1]));
  if (Store.meta.lastfm && Store.meta.lastfm.last) parts.push('Last.fm ' + fmtAgo(Store.meta.lastfm.last));
  if (Store.meta.recent && Store.meta.recent.last) parts.push('Spotify ' + fmtAgo(Store.meta.recent.last));
  if (!parts.length) return null;
  return h('p.sources', 'Извори: ' + parts.join(' · '));
}

/* ---------- Време ---------- */

Views.time = function () {
  if (Store.isEmpty()) return welcomeView();
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const v = h('div.view');
  if (i1 <= i0) { v.appendChild(empty('Нема слушања у овом периоду.')); return v; }
  const st = App.sub('time', { metric: 'ms', bucket: null, year: null });
  const bucket = st.bucket || autoBucket(i0, i1);
  const isMs = st.metric === 'ms';
  const fmtV = isMs ? x => fmtInt(x) + ' мин' : x => countOf(x, 'слушање', 'слушања', 'слушања');

  // Series
  const chartEl = h('div');
  v.appendChild(card(null,
    h('div.card-head', seg([['ms', 'Минути'], ['plays', 'Слушања']], st.metric, m => App.setSub('time', { metric: m }))),
    seg([['day', 'Дан'], ['week', 'Недеља'], ['month', 'Месец'], ['year', 'Година']], bucket, b => App.setSub('time', { bucket: b })),
    chartEl));
  const ser = Stats.series(i0, i1, bucket);
  requestAnimationFrame(() => chartSeries(chartEl, {
    labels: ser.short, full: ser.labels, values: isMs ? ser.ms.map(x => x / 60000) : ser.plays, fmt: fmtV,
    onPick: bucket === 'day' ? i => App.openDay(ser.keys[i]) : null,
  }));
  // Averages
  const nb = ser.keys.length;
  const vals = isMs ? ser.ms.map(x => x / 60000) : ser.plays;
  const best = vals.indexOf(Math.max(...vals));
  v.appendChild(tiles(
    tile('Просек по ' + { day: 'дану', week: 'недељи', month: 'месецу', year: 'години' }[bucket], fmtV(vals.reduce((a, b) => a + b, 0) / Math.max(1, nb))),
    tile('Рекорд', fmtV(vals[best] || 0), ser.labels[best]),
  ));

  // Calendar
  const years = [...new Set(Array.from(Stats.days(i0, i1).keys(), d => dayDate(d).getUTCFullYear()))].sort((a, b) => b - a);
  const year = years.includes(st.year) ? st.year : years[0];
  const calEl = h('div');
  v.appendChild(card('Календар',
    years.length > 1 ? h('div.card-head', h('select.inline-select', { onchange: e => App.setSub('time', { year: +e.target.value }) },
      years.map(y => h('option', { value: y, selected: y === year }, String(y))))) : null,
    calEl, cardNote('Тапни дан да видиш шта си слушао.')));
  requestAnimationFrame(() => chartCalendar(calEl, year, Stats.days(i0, i1), st.metric, d => App.openDay(d)));

  // Hour × weekday
  const hwEl = h('div');
  v.appendChild(card('Када слушаш', hwEl));
  const hw = Stats.hourWeek(i0, i1, st.metric);
  requestAnimationFrame(() => chartHourWeek(hwEl, isMs ? hw.map(r => r.map(x => x / 60000)) : hw, fmtV));
  const rec = Stats.records(i0, i1);
  const wdEl = h('div'), hrEl = h('div');
  v.appendChild(card('По дану у недељи', wdEl));
  chartHBars(wdEl, rec.wdays.map((x, w) => ({ label: WEEKDAYS_SHORT[w], value: x / 3600000 })), x => fmtInt(x) + ' ч');
  v.appendChild(card('По сату', hrEl, cardNote('Највише слушаш око ' + rec.bestHour + ':00, а од дана у недељи ' + WEEKDAYS_ON[rec.bestWeekday] + '.')));
  chartHBars(hrEl, rec.hours.map((x, hh) => ({ label: String(hh).padStart(2, '0') + ':00', value: x / 3600000 })), x => fmtInt(x) + ' ч', COLORS[2]);

  // Year comparison
  const yc = Stats.yearCompare(i0, i1);
  if (yc.length > 1) {
    const ycEl = h('div');
    const last = yc.slice(-8);
    v.appendChild(card('Поређење година', cardNote('Сати слушања од 1. јануара, збирно.'), ycEl));
    const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    requestAnimationFrame(() => chartLines(ycEl, {
      series: last.map((y, k) => ({ name: String(y.year), values: y.values, color: COLORS[k % 8] })),
      labelOf: i => { const d = new Date(Date.UTC(2001, 0, 1) + i * DAY); return d.getUTCDate() + '. ' + MONTHS[d.getUTCMonth()]; },
      xLabels: monthStarts.filter((x, k) => k % 3 === 0).map(i => ({ i, text: MONTHS_SHORT[monthStarts.indexOf(i)] })),
      fmt: x => fmtInt(x) + ' ч',
    }));
  }

  // Streaks & sessions
  const sk = Stats.streaks(i0, i1);
  const ses = Stats.sessions(i0, i1);
  v.appendChild(card('Низови и паузе', tiles(
    tile('Најдужи низ', countOf(sk.best.len, 'дан', 'дана', 'дана'), sk.best.len ? fmtDay(sk.best.from) + ' – ' + fmtDay(sk.best.to) : null),
    tile('Тренутни низ', sk.current ? countOf(sk.current.len, 'дан', 'дана', 'дана') : '–'),
    tile('Најдужа пауза', countOf(sk.gap.len, 'дан', 'дана', 'дана'), sk.gap.len ? fmtDay(sk.gap.from) + ' – ' + fmtDay(sk.gap.to) : null),
  )));
  const sesEl = h('div');
  v.appendChild(card('Сесије слушања',
    cardNote('Сесија се завршава после ' + Settings.get('sessionGapMin') + ' минута тишине.'),
    tiles(
      tile('Сесија', fmtInt(ses.count)),
      tile('Просечно трајање', fmtDur(ses.avg)),
      tile('Најдужа', ses.longest ? fmtDur(ses.longest.end - ses.longest.start) : '–', ses.longest ? fmtDate(ses.longest.start, true) : null),
    ),
    sesEl,
    ses.openers.length ? h('h4', 'Песме којима најчешће почињеш') : null,
    h('div.list', ses.openers.slice(0, 5).map(([id, n], k) => row({
      rank: k + 1, kind: 'track', id, title: entityName('track', id), sub: entitySub('track', id),
      value: countOf(n, 'пут', 'пута', 'пута'), onClick: () => App.openDetail('track', id),
    })))));
  chartHBars(sesEl, ['< 15 мин', '15–30 мин', '30–60 мин', '1–2 ч', '2–4 ч', '4 ч +'].map((label, k) => ({ label, value: ses.buckets[k] })), fmtInt, COLORS[6]);

  // Records
  v.appendChild(card('Рекордни дани', h('div.list', rec.topDays.map((d, k) => row({
    rank: k + 1, title: WEEKDAYS[weekdayOfDay(d.day)] + ', ' + fmtDay(d.day), sub: countOf(d.plays, 'слушање', 'слушања', 'слушања'),
    value: fmtDur(d.ms), onClick: () => App.openDay(d.day),
  })))));
  return v;
};

/* ---------- Топ ---------- */

Views.top = function () {
  if (Store.isEmpty()) return welcomeView();
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const st = App.sub('top', { kind: 'track', metric: 'plays', q: '', race: 'artist' });
  const v = h('div.view');
  if (i1 <= i0) { v.appendChild(empty('Нема слушања у овом периоду.')); return v; }
  const listWrap = h('div');
  const q = h('input.search', { type: 'search', placeholder: 'Претражи…', value: st.q });
  const renderList = () => {
    clear(listWrap);
    let items = Stats.top(i0, i1, st.kind, st.metric);
    const max = items.length ? (st.metric === 'ms' ? items[0].ms : items[0].plays) : 0;
    const ranked = items.map((x, k) => ({ x, rank: k + 1 }));
    const term = foldText(q.value.trim());
    const shown = term ? ranked.filter(r => foldText(entityName(st.kind, r.x.id) + ' ' + entitySub(st.kind, r.x.id)).includes(term)) : ranked;
    listWrap.appendChild(h('p.note', countOf(items.length, st.kind === 'track' ? 'песма' : st.kind === 'artist' ? 'извођач' : 'албум',
      st.kind === 'track' ? 'песме' : st.kind === 'artist' ? 'извођача' : 'албума',
      st.kind === 'track' ? 'песама' : st.kind === 'artist' ? 'извођача' : 'албума')));
    listWrap.appendChild(growList(shown, r => entityRow(st.kind, r.x, r.rank, max, st.metric), 50));
  };
  q.addEventListener('input', debounce(() => { App.state.top.q = q.value; renderList(); }, 200));
  v.appendChild(card(null,
    seg([['track', 'Песме'], ['artist', 'Извођачи'], ['album', 'Албуми']], st.kind, k => App.setSub('top', { kind: k })),
    h('div.card-head', seg([['plays', 'Слушања'], ['ms', 'Минути']], st.metric, m => App.setSub('top', { metric: m })), q),
    listWrap));
  renderList();

  // Race
  const raceEl = h('div');
  v.appendChild(card('Трка кроз време',
    cardNote('Збир слушања месец по месец. Пусти анимацију или померај клизач.'),
    seg([['artist', 'Извођачи'], ['track', 'Песме']], st.race, r => App.setSub('top', { race: r })), raceEl));
  const frames = Stats.race(i0, i1, st.race);
  requestAnimationFrame(() => chartRace(raceEl, frames, id => entityName(st.race, id)));

  // Share over time
  const share = Stats.artistShare(i0, i1);
  if (share && share.labels.length > 1) {
    const shEl = h('div');
    v.appendChild(card('Удео извођача кроз време', shEl));
    requestAnimationFrame(() => chartShare(shEl, share));
  }
  return v;
};

/* ---------- Анализа ---------- */

Views.analysis = function () {
  if (Store.isEmpty()) return welcomeView();
  const P = App.range();
  const [i0, i1] = Stats.range(P);
  const st = App.sub('analysis', { part: 'discover' });
  const v = h('div.view');
  v.appendChild(seg([['discover', 'Откривања'], ['habits', 'Навике'], ['variety', 'Разноврсност']], st.part, p => App.setSub('analysis', { part: p })));
  if (i1 <= i0) { v.appendChild(empty('Нема слушања у овом периоду.')); return v; }
  if (st.part === 'discover') discoverPart(v, i0, i1);
  else if (st.part === 'habits') habitsPart(v, i0, i1);
  else varietyPart(v, i0, i1);
  return v;
};

function discoverPart(v, i0, i1) {
  const d = Stats.discoveries(i0, i1);
  const st = App.sub('analysis', { disc: 'artists' });
  v.appendChild(tiles(
    tile('Нових извођача', fmtInt(d.newArtists.length)),
    tile('Нових песама', fmtInt(d.newTracks.length)),
  ));
  if (d.keys.length > 1) {
    const el = h('div');
    v.appendChild(card('Откривања по месецима',
      seg([['artists', 'Извођачи'], ['tracks', 'Песме']], st.disc, x => App.setSub('analysis', { disc: x })), el));
    requestAnimationFrame(() => chartSeries(el, {
      labels: d.keys.map(k => k % 12 === 0 ? String(Math.floor(k / 12)) : MONTHS_SHORT[k % 12]),
      full: d.keys.map(k => monthKeyLabel(k)), values: st.disc === 'artists' ? d.artists : d.tracks,
      fmt: x => fmtInt(x) + (st.disc === 'artists' ? ' нових извођача' : ' нових песама'), color: COLORS[2],
    }));
  }
  if (d.newArtists.length) {
    const max = d.newArtists[0].plays;
    const f = Stats.firsts();
    v.appendChild(card('Највећа откривања: извођачи', growList(d.newArtists, (x, k) => row({
      rank: k + 1, kind: 'artist', id: x.id, title: entityName('artist', x.id), sub: 'први пут ' + fmtDate(f.ar[x.id]),
      value: fmtInt(x.plays), frac: x.plays / max, onClick: () => App.openDetail('artist', x.id),
    }), 10)));
  }
  if (d.newTracks.length) {
    const max = d.newTracks[0].plays;
    const f = Stats.firsts();
    v.appendChild(card('Највећа откривања: песме', growList(d.newTracks, (x, k) => row({
      rank: k + 1, kind: 'track', id: x.id, title: entityName('track', x.id), sub: entitySub('track', x.id) + ' · од ' + fmtDate(f.tr[x.id]),
      value: fmtInt(x.plays), frac: x.plays / max, onClick: () => App.openDetail('track', x.id),
    }), 10)));
  }
  const obs = Stats.obsessions(i0, i1);
  v.appendChild(card('Опсесије',
    cardNote('Песме које си у неких 30 дана слушао изнова и изнова. „Прошло“ значи да их после тога скоро ниси пуштао.'),
    obs.length ? growList(obs, (x, k) => row({
      rank: k + 1, kind: 'track', id: x.id, title: entityName('track', x.id),
      sub: entitySub('track', x.id) + ' · ' + fmtDate(x.peakStart) + (x.faded ? ' · прошло' : ''),
      value: x.peak + '× / 30 д', onClick: () => App.openDetail('track', x.id),
    }), 10) : empty('Нема их у овом периоду.')));
  const cb = Stats.comebacks(i0, i1);
  v.appendChild(card('Повратници',
    cardNote('Песме којима си се вратио после најмање годину дана паузе.'),
    cb.length ? growList(cb, (x, k) => row({
      rank: k + 1, kind: 'track', id: x.id, title: entityName('track', x.id),
      sub: entitySub('track', x.id) + ' · вратио се ' + fmtDate(x.back),
      value: fmt1(x.gap / (365.25 * DAY)) + ' год', onClick: () => App.openDetail('track', x.id),
    }), 10) : empty('Нема их у овом периоду.')));
  const forgotten = forgottenFavorites();
  if (forgotten.length) {
    v.appendChild(card('Заборављени фаворити',
      cardNote('Много слушане песме које ниси пустио више од годину дана (без обзира на изабрани период).'),
      growList(forgotten, (x, k) => row({
        rank: k + 1, kind: 'track', id: x.id, title: entityName('track', x.id),
        sub: entitySub('track', x.id) + ' · последњи пут ' + fmtDate(x.last),
        value: fmtInt(x.plays), onClick: () => App.openDetail('track', x.id),
      }), 10)));
  }
}

function forgottenFavorites() {
  return Stats.memo('forgotten', () => {
    const c = Stats.cols();
    const top = Stats.top(0, c.n, 'track').slice(0, 1500);
    const out = [];
    const limit = Date.now() - 365 * DAY;
    for (const x of top) {
      if (x.plays < 10) break;
      const idx = Stats.entityPlays('track', x.id);
      const last = c.T[idx[idx.length - 1]];
      if (last < limit) out.push({ id: x.id, plays: x.plays, last });
    }
    return out;
  });
}

function habitsPart(v, i0, i1) {
  const hb = Stats.habits(i0, i1);
  if (!hb.json) {
    v.appendChild(empty('Навике (прескакања, shuffle, уређаји, земље) постоје само у Spotify „Extended streaming history“ извозу. Увези га у подешавањима.'));
    v.appendChild(btn('Увоз', () => App.openSettings('json'), 'wide'));
    return;
  }
  v.appendChild(tiles(
    tile('Прескочено', fmtPct(hb.skipped / hb.json)),
    tile('До краја', fmtPct(hb.completed / hb.json)),
    tile('Shuffle', fmtPct(hb.shuffle / hb.json)),
    tile('Офлајн', fmtPct(hb.offline / hb.json)),
    tile('Приватна сесија', fmtPct(hb.incognito / hb.json)),
    tile('Земаља', fmtInt(hb.countries.length)),
  ));
  if (hb.years.length > 1) {
    const el = h('div');
    v.appendChild(card('Навике по годинама', el));
    requestAnimationFrame(() => chartLines(el, {
      series: [
        { name: 'прескочено', values: hb.years.map(y => y.skip * 100) },
        { name: 'shuffle', values: hb.years.map(y => y.shuffle * 100) },
        { name: 'офлајн', values: hb.years.map(y => y.offline * 100) },
      ],
      labelOf: i => String(hb.years[i].year),
      xLabels: hb.years.map((y, i) => ({ i, text: String(y.year) })).filter((x, i, a) => a.length < 8 || i % 2 === 0),
      fmt: x => fmt1(x) + '%',
    }));
  }
  const platEl = h('div');
  v.appendChild(card('Уређаји (по минутима)', platEl));
  chartSplit(platEl, hb.platforms.map(p => ({ name: p.name, value: p.ms })), x => fmtHours(x) + ' ч');
  if (hb.countries.length) {
    const max = hb.countries[0].n;
    v.appendChild(card('Земље у којима си слушао', h('div.list', hb.countries.slice(0, 30).map((cn, k) => row({
      rank: k + 1, title: flagOf(cn.code) + ' ' + countryName(cn.code), value: fmtInt(cn.n), frac: cn.n / max,
    })))));
  }
  const rsEl = h('div'), reEl = h('div');
  v.appendChild(card('Како песме почињу', rsEl));
  chartSplit(rsEl, hb.reasonStart.map(r => ({ name: reasonLabel(r.name), value: r.n })), fmtInt);
  v.appendChild(card('Како се завршавају', reEl));
  chartSplit(reEl, hb.reasonEnd.map(r => ({ name: reasonLabel(r.name), value: r.n })), fmtInt);
  const skipRow = (x, k) => row({
    rank: k + 1, kind: 'track', id: x.id, title: entityName('track', x.id), sub: entitySub('track', x.id) + ' · ' + countOf(x.n, 'пуштање', 'пуштања', 'пуштања'),
    value: fmtPct(x.rate), onClick: () => App.openDetail('track', x.id),
  });
  v.appendChild(card('Најчешће прескачеш', cardNote('Песме пуштене бар 8 пута.'), h('div.list', hb.mostSkipped.slice(0, 15).map(skipRow))));
  v.appendChild(card('Никад не прескачеш', h('div.list', hb.neverSkipped.slice(0, 15).map(skipRow))));
  v.appendChild(card('Извођачи које прескачеш', h('div.list', hb.artistSkips.slice(0, 15).map((x, k) => row({
    rank: k + 1, kind: 'artist', id: x.id, title: entityName('artist', x.id), sub: countOf(x.n, 'пуштање', 'пуштања', 'пуштања'),
    value: fmtPct(x.rate), onClick: () => App.openDetail('artist', x.id),
  })))));
}

function varietyPart(v, i0, i1) {
  const dv = Stats.diversity(i0, i1);
  if (dv.length > 1) {
    const el = h('div');
    v.appendChild(card('Различитих извођача и песама по години', el));
    requestAnimationFrame(() => chartLines(el, {
      series: [
        { name: 'извођачи', values: dv.map(y => y.artists) },
        { name: 'песме', values: dv.map(y => y.tracks) },
      ],
      labelOf: i => String(dv[i].year),
      xLabels: dv.map((y, i) => ({ i, text: String(y.year) })).filter((x, i, a) => a.length < 8 || i % 2 === 0),
    }));
  }
  v.appendChild(card('Колико је разнолико',
    cardNote('„За пола“: колико извођача чини половину свих слушања — мањи број значи да се вртиш око неколико омиљених.'),
    h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Год.'), h('th', 'Извођ.'), h('th', 'Песме'), h('th', 'За пола'), h('th', 'Топ 10'), h('th', 'Нови'))),
      h('tbody', dv.slice().reverse().map(y => h('tr',
        h('td', String(y.year)), h('td', fmtInt(y.artists)), h('td', fmtInt(y.tracks)), h('td', fmtInt(y.half)),
        h('td', fmtPct(y.top10Share)), h('td', fmtPct(y.newShare)))))))));
  // Artist groups (tags)
  const g = Stats.groups(i0, i1);
  const tagged = Store.artists.filter(a => a.tags && a.tags.length).length;
  const gc = card('Групе извођача',
    cardNote('Разврстај извођаче у групе (нпр. ExYu) на страни извођача, па овде видиш њихов удео кроз године. Групе мењаш у подешавањима.'));
  if (tagged && g.years.length) {
    const el = h('div');
    gc.appendChild(el);
    requestAnimationFrame(() => chartLines(el, {
      series: g.tags.map((tg, k) => ({ name: tg, values: g.years.map(y => y.shares[k] * 100) })),
      labelOf: i => String(g.years[i].year),
      xLabels: g.years.map((y, i) => ({ i, text: String(y.year) })),
      fmt: x => fmt1(x) + '%',
    }));
  } else {
    gc.appendChild(empty('Још ниси разврстао ниједног извођача.'));
  }
  gc.appendChild(btn('Разврстај извођаче', () => App.openTagger(), 'ghost wide'));
  v.appendChild(gc);
}
