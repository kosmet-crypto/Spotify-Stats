/* ---------- importers.js: Spotify data export (ZIP / JSON) ---------- */

/** Minimal ZIP reader: lists entries and inflates them with the browser's DecompressionStream. */
async function readZip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP фајл није исправан');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), cmtLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = dec.decode(new Uint8Array(buf, off + 46, nameLen));
    entries.push({ name, method, csize, local });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return entries.map(e => ({
    name: e.name,
    async text() {
      const lnl = dv.getUint16(e.local + 26, true), lel = dv.getUint16(e.local + 28, true);
      const data = new Uint8Array(buf, e.local + 30 + lnl + lel, e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error('Непознато сажимање у ZIP-у');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    },
  }));
}

const HISTORY_FILE = /(Streaming_?History[^/]*|endsong[^/]*)\.json$/i;

function platformGroup(raw) {
  const s = (raw || '').toLowerCase();
  if (!s) return '';
  if (s.includes('android')) return s.includes('tv') ? 'ТВ / звучник' : 'Android';
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return 'iPhone / iPad';
  if (s.includes('web_player') || s.includes('web player')) return 'Веб';
  if (s.includes('windows')) return 'Windows';
  if (s.includes('os x') || s.includes('osx') || s.includes('mac')) return 'Mac';
  if (s.includes('linux')) return 'Linux';
  if (/(tv|cast|sonos|speaker|echo|alexa|google_home|partner|playstation|xbox|car|auto)/.test(s)) return 'ТВ / звучник';
  return 'Друго';
}

/** Turns one parsed JSON history file into play items for Store.mergePlays(SRC_JSON, …). */
function parseHistoryFile(arr, file) {
  const out = [];
  let podcasts = 0;
  if (!Array.isArray(arr)) return { items: out, podcasts, extended: false };
  const extended = arr.length > 0 && 'ts' in arr[0];
  for (const r of arr) {
    if (extended) {
      const name = r.master_metadata_track_name;
      if (!name) { podcasts++; continue; } // podcast episodes, audiobooks, video
      const end = Date.parse(r.ts);
      const ms = r.ms_played | 0;
      if (!isFinite(end)) continue;
      out.push({
        file, t: end - ms, ms, name,
        artist: r.master_metadata_album_artist_name || '?',
        album: r.master_metadata_album_album_name || '',
        uri: r.spotify_track_uri || '',
        platform: platformGroup(r.platform),
        country: r.conn_country && r.conn_country !== 'ZZ' ? r.conn_country : '',
        reasonStart: r.reason_start || '', reasonEnd: r.reason_end || '',
        flags: (r.shuffle ? F_SHUFFLE : 0) | (r.skipped ? F_SKIPPED : 0) | (r.offline ? F_OFFLINE : 0) | (r.incognito_mode ? F_INCOGNITO : 0),
      });
    } else if (r.endTime && r.trackName) {
      // Short "Account data" history: end time in UTC, minute precision.
      const end = Date.parse(r.endTime.replace(' ', 'T') + ':00Z');
      const ms = r.msPlayed | 0;
      if (!isFinite(end)) continue;
      if (r.artistName === 'Unknown Artist' && r.trackName === 'Unknown Track') continue;
      out.push({ file, t: end - ms, ms, name: r.trackName, artist: r.artistName || '?', album: '' });
    } else if (r.episodeName || r.podcastName) {
      podcasts++;
    }
  }
  return { items: out, podcasts, extended };
}

/**
 * Imports the files the user picked (the export ZIP or its JSON files).
 * progress(text) is called along the way. Returns a summary.
 */
async function importSpotifyFiles(files, progress) {
  const sources = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
      progress('Отварам ' + f.name + '…');
      const entries = await readZip(await f.arrayBuffer());
      for (const e of entries) {
        if (HISTORY_FILE.test(e.name) && !/video/i.test(e.name)) sources.push({ name: e.name.split('/').pop(), text: () => e.text() });
      }
    } else {
      sources.push({ name: f.name, text: () => f.text() });
    }
  }
  if (!sources.length) throw new Error('У изабраним фајловима нема историје слушања (Streaming_History…json).');

  let items = [], podcasts = 0, extended = false, files_ = 0;
  for (const src of sources) {
    progress('Читам ' + src.name + '…');
    await nextFrame();
    let data;
    try { data = JSON.parse(await src.text()); } catch (e) { continue; }
    const r = parseHistoryFile(data, src.name);
    if (!r.items.length && !r.podcasts) continue;
    files_++;
    podcasts += r.podcasts;
    extended = extended || r.extended;
    items = items.concat(r.items);
  }
  if (!items.length) throw new Error('Фајлови не личе на Spotify историју слушања.');
  progress('Спајам ' + fmtInt(items.length) + ' слушања…');
  await nextFrame();
  items.sort((a, b) => a.t - b.t);
  const res = await Store.mergePlays(SRC_JSON, items);
  Store.meta.imports = (Store.meta.imports || []).concat([{
    at: Date.now(), files: files_, plays: items.length, added: res.added, extended,
    from: items[0].t, to: items[items.length - 1].t,
  }]);
  await Store.saveMeta();
  return Object.assign(res, { files: files_, podcasts, extended, total: items.length });
}

/* ---------- backup ---------- */

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
async function saveBytes(name, mime, bytes) {
  if (window.AppAndroid && AppAndroid.saveFile) {
    AppAndroid.saveFile(name, mime, bytesToBase64(bytes));
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportBackup() {
  const bytes = await gzip(JSON.stringify(Store.snapshot()));
  await saveBytes('slusaonica-' + isoDate(Date.now()) + '.json.gz', 'application/gzip', bytes);
}
async function importBackup(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  const text = head[0] === 0x1f && head[1] === 0x8b ? await gunzip(buf) : new TextDecoder().decode(buf);
  await Store.restore(JSON.parse(text));
}
/** CSV of every play, for spreadsheets. */
async function exportCsv() {
  const esc = v => {
    v = v == null ? '' : String(v);
    return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const rows = ['datum,vreme,pesma,izvodjac,album,sekundi,izvor,spotify_uri'];
  for (const p of Store.plays) {
    const t = Store.tracks[p.tr], d = new Date(p.t);
    const src = [p.f & SRC_JSON ? 'json' : '', p.f & SRC_API ? 'spotify' : '', p.f & SRC_LFM ? 'lastfm' : ''].filter(Boolean).join('+');
    rows.push([isoDate(p.t), String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      esc(t.n), esc(Store.artists[t.a].n), esc(t.al >= 0 ? Store.albums[t.al].n : ''),
      p.ms >= 0 ? Math.round(p.ms / 1000) : '', src, t.uri || ''].join(','));
  }
  await saveBytes('slusaonica-' + isoDate(Date.now()) + '.csv', 'text/csv', new TextEncoder().encode('﻿' + rows.join('\n')));
}
