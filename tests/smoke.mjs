// End-to-end check in headless Chromium: demo data, every tab, detail pages, JSON + ZIP import,
// and the duplicate rules between sources. Screenshots go to tests/out/.
// Usage: node tools/build.mjs && NODE_PATH=$(npm root -g) node tests/smoke.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests/out');
mkdirSync(out, { recursive: true });

// ---------- sample export files (same generator as the in-app demo) ----------
const ctx = vm.createContext({ console, Intl, Date, Math, TextEncoder, crypto: globalThis.crypto });
vm.runInContext(readFileSync(join(root, 'src/js/util.js'), 'utf8') + '\n' + readFileSync(join(root, 'src/js/demo.js'), 'utf8') + '\nthis.demoHistory = demoHistory;', ctx);
const hist = ctx.demoHistory({ seed: 7, days: 900 });
const half = Math.floor(hist.length / 2);
const f1 = join(out, 'Streaming_History_Audio_2023-2024_0.json');
const f2 = join(out, 'Streaming_History_Audio_2024-2025_1.json');
writeFileSync(f1, JSON.stringify(hist.slice(0, half)));
writeFileSync(f2, JSON.stringify(hist.slice(half)));
const zip = join(out, 'my_spotify_data.zip');
execFileSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
z.write(sys.argv[2],'Spotify Extended Streaming History/'+sys.argv[2].split('/')[-1])
z.write(sys.argv[3],'Spotify Extended Streaming History/'+sys.argv[3].split('/')[-1])
z.writestr('Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf','x')
z.close()`, zip, f1, f2]);
const expectedTracks = hist.length;

// ---------- static server ----------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'sr-RS', timezoneId: 'Europe/Belgrade' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };
const shot = async name => page.screenshot({ path: join(out, name + '.png'), fullPage: true });
const tab = async id => { await page.click(`.tabs button[data-tab="${id}"]`); await page.waitForTimeout(400); };

await page.goto(base);
await page.waitForSelector('.hero-welcome');
await shot('00-welcome');

// ---------- demo data and every screen ----------
await page.click('text=Учитај пробне податке');
await page.waitForSelector('.hero-value', { timeout: 60000 });
const demoPlays = await page.evaluate(() => Store.plays.length);
check(demoPlays > 10000, 'demo loaded: ' + demoPlays + ' plays');
await shot('01-overview');
await tab('time'); await shot('02-time');
await page.click('.seg button:has-text("Дан")'); await page.waitForTimeout(300); await shot('02b-time-days');
await tab('top'); await shot('03-top');
await page.click('.seg button:has-text("Извођачи")'); await page.waitForTimeout(300);
await tab('analysis'); await shot('04-discover');
await page.click('.seg button:has-text("Навике")'); await page.waitForTimeout(300); await shot('05-habits');
await page.click('.seg button:has-text("Разноврсност")'); await page.waitForTimeout(300); await shot('06-variety');
await tab('spotify'); await shot('07-spotify');
await tab('overview');
await page.click('.chips .chip:nth-child(3)'); await page.waitForTimeout(300); // a year
await shot('08-year');
await page.click('.list .row.click >> nth=0'); await page.waitForSelector('.overlay.in'); await page.waitForTimeout(300);
await shot('09-track');
await page.click('.overlay.in .detail-head a.link >> nth=0'); await page.waitForTimeout(400);
await shot('10-artist');
await page.evaluate(() => { App.back(); App.back(); });
await page.waitForTimeout(300);
await page.click('.wrapped-btn'); await page.waitForTimeout(400); await shot('11-wrapped');
await page.evaluate(() => App.back());
await page.click('#settings-btn'); await page.waitForTimeout(400); await shot('12-settings');
await page.evaluate(() => App.back());
await tab('time');
await page.click('.cal-c >> nth=100'); await page.waitForTimeout(400); await shot('13-day');
await page.evaluate(() => App.back());

// Light theme
await page.emulateMedia({ colorScheme: 'light' });
await tab('overview'); await shot('14-overview-light');
await tab('time'); await shot('15-time-light');
await page.emulateMedia({ colorScheme: 'dark' });

// Persistence
await page.reload();
await page.waitForSelector('.hero-value, .view');
check(await page.evaluate(() => Store.plays.length) === demoPlays, 'data survives a reload');

// ---------- import: JSON files, then the same data as ZIP (must add nothing) ----------
await page.evaluate(async () => { await Store.wipe(); App.dataChanged(); });
await page.waitForSelector('.hero-welcome');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Увези ZIP / JSON >> nth=0')]);
await chooser.setFiles([f1, f2]);
await page.waitForSelector('text=Увоз је готов', { timeout: 60000 });
const afterJson = await page.evaluate(() => Store.plays.length);
check(afterJson === expectedTracks, `JSON import: ${afterJson} of ${expectedTracks} plays`);
await page.evaluate(() => App.back());
await page.evaluate(() => App.openSettings('json'));
await page.waitForTimeout(300);
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.overlay.in >> text=Увези ZIP / JSON')]);
await chooser2.setFiles([zip]);
await page.waitForSelector('text=Увоз је готов', { timeout: 60000 });
check(await page.evaluate(() => Store.plays.length) === afterJson, 'ZIP re-import adds no duplicates');
await page.evaluate(() => { App.back(); App.back(); });

// ---------- merge rules between sources ----------
const merge = await page.evaluate(async () => {
  const P = Store.plays;
  const covEnd = Store.coverage[Store.coverage.length - 1][1];
  const sample = P.slice(-40).map(p => {
    const t = Store.tracks[p.tr];
    return { t: p.t + 20000, ms: -1, name: t.n + ' - Remastered 2011', artist: Store.artists[t.a].n };
  });
  const r1 = await Store.mergePlays(SRC_LFM, sample); // inside the export's time: dropped
  const after = [];
  for (let k = 0; k < 5; k++) after.push({ t: covEnd + (k + 1) * 3600000, ms: -1, name: 'Нова песма ' + k, artist: 'Тест' });
  const r2 = await Store.mergePlays(SRC_LFM, after);
  // The same plays seen by Spotify's recently played 40 s later: merged, not added.
  const api = after.map(x => Object.assign({}, x, { t: x.t + 40000, uri: 'spotify:track:test' }));
  const r3 = await Store.mergePlays(SRC_API, api);
  const r4 = await Store.mergePlays(SRC_API, api); // again: nothing
  // A song played twice in a row (repeat) stays two plays.
  const rep = [{ t: covEnd + 10 * 3600000, ms: -1, name: 'Реприза', artist: 'Тест' }, { t: covEnd + 10 * 3600000 + 200000, ms: -1, name: 'Реприза', artist: 'Тест' }];
  const r5 = await Store.mergePlays(SRC_LFM, rep);
  const r6 = await Store.mergePlays(SRC_API, rep.map(x => Object.assign({}, x, { t: x.t + 30000 })));
  return { r1, r2, r3, r4, r5, r6, both: Store.plays.filter(p => (p.f & SRC_LFM) && (p.f & SRC_API)).length };
});
check(merge.r1.added === 0 && merge.r1.skipped === 40, 'Last.fm inside export time is dropped');
check(merge.r2.added === 5, 'Last.fm after export time is added');
check(merge.r3.added === 0 && merge.r3.merged === 5, 'Spotify recent + Last.fm of the same plays merge');
check(merge.r4.added === 0 && merge.r4.merged === 0, 'fetching the same recent plays again changes nothing');
check(merge.r5.added === 2 && merge.r6.merged === 2 && merge.r6.added === 0, 'a repeated song stays two plays across sources');

// Normalization
const norm = await page.evaluate(() => [
  trackKey('Riblja Čorba', 'Lutka sa naslovne strane - Remastered 2011') === trackKey('Рибља Чорба', 'Лутка са насловне стране'),
  trackKey('Artist feat. X', 'Song (feat. Someone)') === trackKey('Artist', 'Song'),
  trackKey('The Band', 'Song - Live') !== trackKey('The Band', 'Song'),
  trackKey('Đorđe Balašević', 'Ne lomite mi bagrenje') === trackKey('Ђорђе Балашевић', 'Не ломите ми багрење'),
]);
check(norm.every(Boolean), 'name matching across scripts and versions: ' + JSON.stringify(norm));

check(errors.length === 0, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
await browser.close();
server.close();
console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
