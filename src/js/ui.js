/* ---------- ui.js: shared components (rows, tiles, covers, sheets, toasts) and the period ---------- */

function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.className = ''; }, isError ? 5000 : 2600);
}

function card(title, ...children) {
  return h('section.card', title ? h('h3.card-title', title) : null, children);
}
function cardNote(text) { return h('p.note', text); }
function tile(label, value, sub) {
  return h('div.tile', h('div.tile-label', label), h('div.tile-value', value), sub ? h('div.tile-sub', sub) : null);
}
function tiles(...items) { return h('div.tiles', items); }
function empty(text) { return h('div.empty', text); }

/** Segmented control. options: [[value, label]], onChange(value). */
function seg(options, value, onChange) {
  const el = h('div.seg', { role: 'tablist' });
  for (const [v, label] of options) {
    el.appendChild(h('button' + (v === value ? '.on' : ''), {
      type: 'button', role: 'tab', 'aria-selected': v === value ? 'true' : 'false',
      onclick: () => { if (v !== value) onChange(v); },
    }, label));
  }
  return el;
}

function btn(label, onClick, cls = '') {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick: onClick }, label);
}
/** Runs an async action with the button disabled and errors shown as a toast. */
function busyBtn(label, action, cls) {
  const b = btn(label, async () => {
    if (b.disabled) return;
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '…';
    try { await action(b); } catch (e) { console.error(e); toast(e.message || String(e), true); }
    finally { b.disabled = false; if (b.textContent === '…') b.textContent = old; }
  }, cls);
  return b;
}

function initials(name) {
  const w = (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}
function artistImg(artistId) {
  const a = Store.artists[artistId];
  if (a.img) return a.img;
  const m = Stats.memo('artImg', () => {
    const map = new Map();
    const top = Stats.top(0, Stats.cols().n, 'track');
    for (const x of top) {
      const t = Store.tracks[x.id];
      if (t.img && !map.has(t.a)) map.set(t.a, t.img);
    }
    return map;
  });
  return m.get(artistId) || '';
}
/** Cover image for a track / album / artist; fetched lazily from Spotify when missing. */
function cover(kind, id, size = 44) {
  let url = '', name = '';
  if (kind === 'track') { const t = Store.tracks[id]; url = t.img || ''; name = t.n; }
  else if (kind === 'album') { const al = Store.albums[id]; url = al.img || ''; name = al.n; }
  else { url = artistImg(id); name = Store.artists[id].n; }
  const el = h('span.cover' + (kind === 'artist' ? '.round' : ''), { style: { width: size + 'px', height: size + 'px' } });
  const setImg = u => {
    clear(el);
    const img = h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.onerror = () => { clear(el); el.appendChild(h('span.cover-txt', initials(name))); };
    el.appendChild(img);
  };
  if (url) setImg(url);
  else {
    el.appendChild(h('span.cover-txt', initials(name)));
    if (kind === 'track') Covers.want(id, u => u && el.isConnected && setImg(u));
    else if (kind === 'album') {
      const tid = Store.tracks.findIndex(t => t.al === id && t.uri);
      if (tid >= 0) Covers.want(tid, u => u && el.isConnected && setImg(u));
    }
  }
  return el;
}

function entityName(kind, id) {
  if (kind === 'track') return cleanTitle(Store.tracks[id].n);
  if (kind === 'album') return Store.albums[id].n;
  return Store.artists[id].n;
}
function entitySub(kind, id) {
  if (kind === 'track') return Store.artists[Store.tracks[id].a].n;
  if (kind === 'album') return Store.artists[Store.albums[id].a].n;
  return '';
}

/**
 * List row: rank · cover · title/sub · value (+ bar). onClick opens detail.
 * opts: {rank, kind, id, title, sub, value, frac, right (element), onClick}
 */
function row(opts) {
  const el = h('div.row' + (opts.onClick ? '.click' : ''), { onclick: opts.onClick || null });
  if (opts.rank != null) el.appendChild(h('span.rank', String(opts.rank)));
  if (opts.kind) el.appendChild(cover(opts.kind, opts.id));
  const mid = h('span.row-mid', h('span.row-title', opts.title), opts.sub ? h('span.row-sub', opts.sub) : null);
  if (opts.frac != null) mid.appendChild(h('span.row-bar', h('span', { style: { width: Math.max(1, opts.frac * 100) + '%' } })));
  el.appendChild(mid);
  if (opts.value != null) el.appendChild(h('span.row-val', opts.value));
  if (opts.right) el.appendChild(opts.right);
  return el;
}
function entityRow(kind, x, rank, max, metric) {
  const v = metric === 'ms' ? x.ms : x.plays;
  return row({
    rank, kind, id: x.id, title: entityName(kind, x.id), sub: entitySub(kind, x.id),
    value: metric === 'ms' ? fmtDur(x.ms) : fmtInt(x.plays), frac: max ? v / max : 0,
    onClick: () => App.openDetail(kind, x.id),
  });
}
/** A list that shows `step` rows and grows on "Прикажи још". */
function growList(items, makeRow, step = 25) {
  const wrap = h('div.list');
  let shown = 0;
  const more = btn('Прикажи још', () => add(), 'ghost wide');
  const add = () => {
    const next = items.slice(shown, shown + step);
    next.forEach((x, k) => wrap.insertBefore(makeRow(x, shown + k), more));
    shown += next.length;
    more.style.display = shown < items.length ? '' : 'none';
  };
  wrap.appendChild(more);
  add();
  return wrap;
}

/* ---------- sheet (bottom dialog) ---------- */

function sheet(title, content, onClose) {
  const back = h('div.sheet-back');
  const panel = h('div.sheet', h('div.sheet-head', h('b', title), btn('✕', () => close(), 'icon')), content);
  back.appendChild(panel);
  const close = () => { back.remove(); App.popBack(close); onClose && onClose(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  document.body.appendChild(back);
  App.pushBack(close);
  return close;
}
function confirmSheet(title, text, okLabel, action) {
  const close = sheet(title, h('div.sheet-body', h('p', text), h('div.btn-row',
    btn('Откажи', () => close(), 'ghost'),
    busyBtn(okLabel, async () => { await action(); close(); }, 'danger'))));
}

/* ---------- periods ---------- */

/** Resolves the stored period description into {from, to, label, days}. */
function resolvePeriod(p) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (p.kind) {
    case 'year':
      return { from: new Date(p.year, 0, 1).getTime(), to: new Date(p.year + 1, 0, 1).getTime(), label: p.year + '.', short: String(p.year) };
    case 'month':
      return { from: new Date(p.year, p.month, 1).getTime(), to: new Date(p.year, p.month + 1, 1).getTime(), label: MONTHS[p.month] + ' ' + p.year + '.', short: MONTHS_SHORT[p.month] + ' ' + p.year };
    case 'last': {
      const from = todayStart - (p.days - 1) * DAY;
      return { from, to: todayStart + DAY, label: 'последњих ' + p.days + ' дана', short: p.days + ' дана' };
    }
    case 'custom': {
      const from = new Date(p.from + 'T00:00').getTime(), to = new Date(p.to + 'T00:00').getTime() + DAY;
      return { from, to, label: fmtDate(from) + ' – ' + fmtDate(to - DAY), short: 'прилагођено' };
    }
    default:
      return { from: -Infinity, to: Infinity, label: 'све време', short: 'Све' };
  }
}
function dataYears() {
  const c = Stats.cols();
  if (!c.n) return [];
  const y0 = new Date(c.T[0]).getFullYear(), y1 = new Date(c.T[c.n - 1]).getFullYear();
  const out = [];
  for (let y = y1; y >= y0; y--) out.push(y);
  return out;
}

function periodBar() {
  const p = App.period;
  const bar = h('div.chips');
  const chip = (label, on, fn) => bar.appendChild(h('button.chip' + (on ? '.on' : ''), { type: 'button', onclick: fn }, label));
  chip('Све', p.kind === 'all', () => App.setPeriod({ kind: 'all' }));
  chip('30 дана', p.kind === 'last' && p.days === 30, () => App.setPeriod({ kind: 'last', days: 30 }));
  for (const y of dataYears()) chip(String(y), p.kind === 'year' && p.year === y, () => App.setPeriod({ kind: 'year', year: y }));
  const special = (p.kind === 'month' || p.kind === 'custom' || (p.kind === 'last' && p.days !== 30));
  chip(special ? resolvePeriod(p).short + ' ▾' : 'Још ▾', special, () => periodSheet());
  requestAnimationFrame(() => { const on = $('.chip.on', bar); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  return bar;
}

function periodSheet() {
  const years = dataYears();
  const body = h('div.sheet-body');
  const close = sheet('Изабери период', body);
  const pick = p => { close(); App.setPeriod(p); };
  body.appendChild(h('div.btn-grid',
    [7, 90, 180, 365].map(d => btn('Последњих ' + d + ' дана', () => pick({ kind: 'last', days: d }), 'ghost'))));
  if (years.length) {
    const ySel = h('select', years.map(y => h('option', { value: y }, String(y))));
    const mSel = h('select', MONTHS.map((m, i) => h('option', { value: i }, m)));
    const now = new Date();
    mSel.value = String(now.getMonth());
    body.appendChild(h('div.field', h('label', 'Месец'), h('div.inline', mSel, ySel,
      btn('Прикажи', () => pick({ kind: 'month', year: +ySel.value, month: +mSel.value })))));
  }
  const f = h('input', { type: 'date', value: isoDate(Date.now() - 30 * DAY) });
  const t = h('input', { type: 'date', value: isoDate(Date.now()) });
  body.appendChild(h('div.field', h('label', 'Од – до'), h('div.inline', f, t,
    btn('Прикажи', () => { if (f.value && t.value && f.value <= t.value) pick({ kind: 'custom', from: f.value, to: t.value }); }))));
}

/** Picks the chart bucket that gives a readable number of columns for a period. */
function autoBucket(i0, i1) {
  const c = Stats.cols();
  if (i1 <= i0) return 'month';
  const span = c.DAY[i1 - 1] - c.DAY[i0];
  if (span <= 62) return 'day';
  if (span <= 370) return 'week';
  if (span <= 12 * 366) return 'month';
  return 'year';
}

const REASON_LABELS = {
  trackdone: 'песма се завршила', fwdbtn: 'дугме „следећа“', backbtn: 'дугме „претходна“', endplay: 'заустављено',
  logout: 'одјава', remote: 'даљинско управљање', clickrow: 'клик на песму', playbtn: 'дугме „пусти“',
  appload: 'покретање апликације', trackerror: 'грешка', unexpected_exit: 'неочекивани излаз',
  unexpected_exit_while_paused: 'излаз током паузе', popup: 'искачући прозор', uriopen: 'отворен линк',
  unknown: 'непознато', switched_to_audio: 'прелаз на звук', switched_to_video: 'прелаз на видео', '': 'непознато',
};
function reasonLabel(r) { return REASON_LABELS[r] || r; }

function flagOf(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}
const regionNames = (() => { try { return new Intl.DisplayNames(['sr-Cyrl'], { type: 'region' }); } catch (e) { return null; } })();
function countryName(code) {
  try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
}
