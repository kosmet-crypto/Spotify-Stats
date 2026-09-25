/* ---------- util.js: DOM helpers, formatting, dates, name normalization ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** h('div.card', {onclick}, child, 'text', [children]) — tiny element builder; text is always textContent. */
function h(tag, attrs, ...children) {
  const m = /^([a-z0-9]+)?((?:\.[\w-]+)*)(?:#([\w-]+))?$/i.exec(tag);
  const el = document.createElement(m[1] || 'div');
  if (m[2]) el.className = m[2].slice(1).replace(/\./g, ' ');
  if (m[3]) el.id = m[3];
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v; // only for trusted, static markup (icons)
      else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  for (const c of children) if (c != null) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/* ---------- numbers ---------- */

const nfInt = new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 1 });
function fmtInt(n) { return nfInt.format(Math.round(n || 0)); }
function fmt1(n) { return nf1.format(n || 0); }
function fmtCompact(n) {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return nf1.format(n / 1e6) + ' мил';
  if (a >= 1e4) return nfInt.format(n / 1e3) + ' хиљ';
  return fmtInt(n);
}
function fmtPct(x, digits = 0) {
  if (!isFinite(x)) return '–';
  return (x * 100).toFixed(digits).replace('.', ',') + '%';
}
/** Milliseconds as "12 ч 5 мин" / "42 мин" / "35 с". */
function fmtDur(ms) {
  ms = ms || 0;
  const min = ms / 60000;
  if (min < 1) return Math.round(ms / 1000) + ' с';
  if (min < 60) return Math.round(min) + ' мин';
  const hrs = Math.floor(min / 60);
  if (hrs < 48) return hrs + ' ч ' + Math.round(min - hrs * 60) + ' мин';
  const days = Math.floor(hrs / 24);
  return fmtInt(days) + ' д ' + (hrs - days * 24) + ' ч';
}
function fmtHours(ms) { return fmtInt(ms / 3600000); }
function fmtMin(ms) { return fmtInt(ms / 60000); }
function fmtClock(ms) {
  const sec = Math.round(ms / 1000);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

/** Serbian plural: plural(5, 'песма', 'песме', 'песама'). */
function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
function countOf(n, one, few, many) { return fmtInt(n) + ' ' + plural(Math.round(n), one, few, many); }

/* ---------- dates (all stats use the phone's local time) ---------- */

const DAY = 86400000;
const MONTHS = ['јануар', 'фебруар', 'март', 'април', 'мај', 'јун', 'јул', 'август', 'септембар', 'октобар', 'новембар', 'децембар'];
const MONTHS_SHORT = ['јан', 'феб', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'нов', 'дец'];
const WEEKDAYS = ['понедељак', 'уторак', 'среда', 'четвртак', 'петак', 'субота', 'недеља'];
const WEEKDAYS_SHORT = ['пон', 'уто', 'сре', 'чет', 'пет', 'суб', 'нед'];
const WEEKDAYS_ON = ['понедељком', 'уторком', 'средом', 'четвртком', 'петком', 'суботом', 'недељом'];

/** Local day number (days since 1970-01-01 in local time). */
function dayNum(t) {
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60000) / DAY);
}
/** Start of a local day number, as ms. */
function dayStart(n) {
  const d = new Date(n * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}
function dayDate(n) { return new Date(n * DAY); } // read with getUTC*
/** Monday = 0 … Sunday = 6. */
function weekdayOfDay(n) { return (n + 3) % 7; }
function monthKeyOfDay(n) { const d = dayDate(n); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
function monthKeyLabel(k, short) {
  const y = Math.floor(k / 12), m = k % 12;
  return short ? MONTHS_SHORT[m] + ' ' + String(y).slice(2) : MONTHS[m] + ' ' + y;
}
function monthKeyStart(k) { return new Date(Math.floor(k / 12), k % 12, 1).getTime(); }
function fmtDay(n, withYear = true) {
  const d = dayDate(n);
  return d.getUTCDate() + '. ' + MONTHS[d.getUTCMonth()] + (withYear ? ' ' + d.getUTCFullYear() + '.' : '');
}
function fmtDate(t, withTime) {
  if (!t) return '–';
  const d = new Date(t);
  let s = d.getDate() + '. ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear() + '.';
  if (withTime) s += ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return s;
}
function fmtAgo(t) {
  const d = Date.now() - t;
  if (d < 60000) return 'малопре';
  if (d < 3600000) return 'пре ' + Math.round(d / 60000) + ' мин';
  if (d < DAY) return 'пре ' + Math.round(d / 3600000) + ' ч';
  return fmtDate(t);
}
function isoDate(t) {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- name normalization (matching the same song across sources) ---------- */

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj',
  м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c',
  џ: 'dz', ш: 's', й: 'j', ы: 'y', э: 'e', ю: 'ju', я: 'ja', ь: '', ъ: '', ё: 'e', є: 'e', і: 'i', ї: 'i', ґ: 'g', щ: 'sc',
};
function foldText(str) {
  let out = '';
  for (const ch of str.toLowerCase()) out += CYR[ch] !== undefined ? CYR[ch] : ch;
  return out.replace(/đ/g, 'dj').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ł/g, 'l')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Suffixes that name the same recording: "- Remastered 2011", "(feat. X)", "- Radio Edit", "[Mono]" …
const VERSION_WORDS = /\b(remaster(ed)?|re-?master(ed)?|mono|stereo|radio edit|single version|album version|original mix|original version|explicit|clean|bonus track|deluxe|anniversary|edit(ion)?|mixed|digital(ly)?|\d{4} (mix|version|remaster))\b/;
function normTitle(t) {
  let x = foldText(t || '');
  x = x.replace(/[([{]\s*(feat\.?|ft\.?|featuring|with)\s[^)\]}]*[)\]}]/g, ' ');
  x = x.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, ' ');
  // Bracketed version notes.
  x = x.replace(/[([{]([^)\]}]*)[)\]}]/g, (all, inner) => (VERSION_WORDS.test(inner) ? ' ' : ' ' + inner + ' '));
  // " - Remastered 2009", " - Mono" …
  x = x.replace(/\s[-–—]\s(.*)$/, (all, tail) => (VERSION_WORDS.test(tail) ? ' ' : ' ' + tail));
  return x.replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function normArtist(a) {
  let x = foldText(a || '');
  x = x.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, '');
  x = x.replace(/^the\s/, '');
  return x.replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** Title for display: drops "- Remastered 2011" style notes (the name stays the same song either way). */
function cleanTitle(t) {
  return (t || '').replace(/\s+[-–]\s+(\d{4}\s+)?(digital(ly)?\s+)?remaster(ed)?(\s+\d{4})?(\s+version)?$/i, '')
    .replace(/\s*[([](\d{4}\s+)?(digital(ly)?\s+)?remaster(ed)?[^)\]]*[)\]]/i, '').trim() || t;
}
function trackKey(artist, title) { return normArtist(artist) + '\u0001' + normTitle(title); }

/* ---------- misc ---------- */

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
/** First index i in sorted array/typed array `arr` with arr[i] >= x. */
function lowerBound(arr, x, lo = 0, hi = arr.length) {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function topN(map, n, score) {
  const arr = [];
  for (const [k, v] of map) arr.push([k, v]);
  arr.sort((a, b) => score(b[1]) - score(a[1]));
  return arr.slice(0, n);
}
function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const v = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += chars[v[i] % chars.length];
  return out;
}
function b64url(bytes) {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function spotifyIdFromUri(uri) { return uri && uri.startsWith('spotify:track:') ? uri.slice(14) : null; }
function spotifyOpenUrl(uri) {
  if (!uri) return null;
  const p = uri.split(':');
  return p.length === 3 ? 'https://open.spotify.com/' + p[1] + '/' + p[2] : null;
}
function lsGet(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
}
