/* ---------- demo.js: made-up listening history in Spotify's export format ----------
Used by "Учитај пробне податке" and by the test tools (tools/make-sample.mjs).
Deterministic (seeded), about six years, fictional artists.
*/

function demoHistory(opts = {}) {
  let seed = opts.seed || 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const syl = ['ka', 'lo', 'mi', 're', 'na', 'to', 'vi', 'sa', 'de', 'ru', 'zo', 'le', 'ba', 'ni', 'po', 'ma', 'ti', 'ko'];
  const word = n => { let w = ''; for (let i = 0; i < n; i++) w += pick(syl); return w[0].toUpperCase() + w.slice(1); };
  const titles = ['Ноћ', 'Кише', 'Summer', 'Лето', 'Neon', 'Река', 'Midnight', 'Звезде', 'Paper', 'Ветар', 'Gold', 'Сан', 'Echo', 'Пут', 'Fire', 'Море', 'Blue', 'Јутро', 'Stay', 'Сенке'];
  const title = () => pick(titles) + (rnd() < 0.5 ? ' ' + pick(titles).toLowerCase() : '') + (rnd() < 0.08 ? ' - Remastered 2011' : '');
  const artists = [];
  const nArt = 70;
  for (let a = 0; a < nArt; a++) {
    const name = rnd() < 0.35 ? word(2) + ' ' + word(2) : (rnd() < 0.5 ? 'The ' : '') + word(3);
    const albums = [];
    const nAl = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < nAl; k++) {
      const tracks = [];
      const nTr = 3 + Math.floor(rnd() * 8);
      for (let t = 0; t < nTr; t++) tracks.push({ name: title(), dur: 150000 + Math.floor(rnd() * 150000), uri: 'spotify:track:demo' + a + 'x' + k + 'x' + t });
      albums.push({ name: word(2) + ' ' + pick(titles), tracks });
    }
    // Each artist has a "life": when you discover them and how long they stay popular.
    artists.push({ name, albums, weight: Math.pow(rnd(), 2.2), start: rnd() * 0.85, span: 0.1 + rnd() * 0.9 });
  }
  const platforms = ['Android OS 13 API 33 (samsung, SM-S911B)', 'windows 10 (10.0.19045; x64)', 'web_player windows 10;chrome 120', 'Partner google cast_tv;Chromecast'];
  const countries = ['RS', 'RS', 'RS', 'RS', 'RS', 'RS', 'RS', 'RS', 'HR', 'GR', 'DE', 'IT'];
  const endReasons = ['trackdone', 'trackdone', 'trackdone', 'trackdone', 'fwdbtn', 'fwdbtn', 'endplay', 'backbtn'];
  const days = opts.days || 6 * 365;
  const now = Date.now();
  const start = now - days * DAY;
  const out = [];
  let country = 'RS', trip = 0;
  for (let d = 0; d < days; d++) {
    const dayT = start + d * DAY;
    const phase = d / days;
    const wd = new Date(dayT).getDay();
    if (trip > 0) trip--; else if (rnd() < 0.006) { trip = 3 + Math.floor(rnd() * 10); country = pick(countries.slice(8)); } else country = 'RS';
    if (rnd() < 0.08) continue; // a quiet day
    const active = artists.filter(a => phase >= a.start && phase <= a.start + a.span);
    if (!active.length) continue;
    const sessions = 1 + Math.floor(rnd() * (wd === 0 || wd === 6 ? 4 : 3));
    for (let s0 = 0; s0 < sessions; s0++) {
      const hour = pick([7, 8, 8, 9, 12, 13, 17, 18, 19, 20, 21, 21, 22, 23, 0]);
      let t = dayT - (dayT % DAY) + hour * 3600000 + Math.floor(rnd() * 3600000) - 3600000;
      const plat = rnd() < 0.7 ? platforms[0] : pick(platforms);
      const shuffle = rnd() < 0.45;
      const len = 3 + Math.floor(rnd() * 22);
      // Obsession: sometimes one song dominates a stretch of days.
      let focus = null;
      if (rnd() < 0.15) { const a = pick(active); focus = pick(pick(a.albums).tracks); }
      for (let k = 0; k < len; k++) {
        let r = rnd() * active.reduce((x, a) => x + a.weight, 0);
        let art = active[0];
        for (const a of active) { r -= a.weight; if (r <= 0) { art = a; break; } }
        const al = pick(art.albums);
        const tr = focus && rnd() < 0.5 ? focus : pick(al.tracks);
        const trArtist = focus && tr === focus ? artists.find(a => a.albums.some(x => x.tracks.includes(tr))) : art;
        const trAlbum = trArtist.albums.find(x => x.tracks.includes(tr));
        const reason = pick(endReasons);
        const ms = reason === 'trackdone' ? tr.dur : Math.floor(rnd() * tr.dur * 0.6);
        t += ms + 2000;
        out.push({
          ts: new Date(t).toISOString().replace(/\.\d+Z$/, 'Z'), platform: plat, ms_played: ms, conn_country: country,
          master_metadata_track_name: tr.name, master_metadata_album_artist_name: trArtist.name,
          master_metadata_album_album_name: trAlbum.name, spotify_track_uri: tr.uri,
          reason_start: k === 0 ? 'clickrow' : (rnd() < 0.8 ? 'trackdone' : 'fwdbtn'), reason_end: reason,
          shuffle, skipped: reason === 'fwdbtn' && ms < 30000, offline: rnd() < 0.05, incognito_mode: rnd() < 0.01,
        });
        if (t > now) break;
      }
    }
  }
  return out.filter(x => Date.parse(x.ts) < now);
}

async function loadDemo() {
  await Store.wipe();
  const arr = demoHistory();
  const { items } = parseHistoryFile(arr, 'demo');
  items.sort((a, b) => a.t - b.t);
  await Store.mergePlays(SRC_JSON, items);
  // Demo URIs are not real; covers stay initials.
  for (const t of Store.tracks) { delete t.uri; }
  Store.meta.demo = true;
  await Store.save(null);
}
