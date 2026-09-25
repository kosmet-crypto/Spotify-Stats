/* ---------- settings.js: sources, options, data ---------- */

function settingsView(focus) {
  const v = h('div.view');
  v.appendChild(spotifySettings());
  v.appendChild(jsonSettings());
  v.appendChild(lastfmSettings());
  v.appendChild(coverageCard());
  v.appendChild(statsSettings());
  v.appendChild(groupSettings());
  v.appendChild(dataSettings());
  v.appendChild(aboutCard());
  if (focus) requestAnimationFrame(() => { const el = $('#set-' + focus, v); if (el) el.scrollIntoView({ block: 'start' }); });
  return v;
}

function copyField(value) {
  const input = h('input', { type: 'text', value, readOnly: true });
  return h('div.inline', input, btn('Копирај', async () => {
    try { await navigator.clipboard.writeText(value); toast('Копирано'); }
    catch (e) { input.select(); document.execCommand('copy'); toast('Копирано'); }
  }, 'ghost small'));
}

function spotifySettings() {
  const c = card('Spotify');
  c.id = 'set-spotify';
  const logged = SP.configured() && SP.loggedIn();
  if (logged) {
    const who = h('p', 'Пријављен.');
    SP.profile().then(me => { who.textContent = 'Пријављен као ' + (me.display_name || me.id) + '.'; }).catch(() => {});
    c.appendChild(who);
    c.appendChild(toggleRow('Преузимај недавна слушања при покретању', 'recentAuto'));
    if (IS_APP) {
      const info = h('p.note');
      const upd = () => {
        try {
          const j = JSON.parse(AppAndroid.backgroundSyncInfo());
          info.textContent = (j.enabled ? 'Укључено. ' : 'Искључено. ') + (j.lastRun ? 'Последње преузимање: ' + fmtAgo(j.lastRun) + '.' : '');
        } catch (e) { info.textContent = ''; }
      };
      c.appendChild(toggleRow('Бележи у позадини (сваких сат времена)', 'bgSync', on => { AppAndroid.setBackgroundSync(on); setTimeout(upd, 300); }));
      c.appendChild(cardNote('Spotify памти само последњих 50 песама. Позадинско бележење их преузима и кад је апликација затворена, да се ништа не изгуби. Ако телефон агресивно штеди батерију, искључи штедњу за Слушаоницу.'));
      c.appendChild(info);
      upd();
    }
    c.appendChild(h('div.btn-row',
      busyBtn('Преузми сада', () => Sync.run({ force: true, report: true }), 'ghost'),
      btn('Одјави се', () => { SP.logout(); App.render(); App.openSettings('spotify'); }, 'ghost')));
    return c;
  }
  const id = h('input', { type: 'text', value: Settings.get('clientId'), placeholder: 'нпр. 3f9c…', autocomplete: 'off', spellcheck: false });
  id.addEventListener('change', () => Settings.set('clientId', id.value.trim()));
  c.appendChild(cardNote('Spotify тражи да свако направи своју (бесплатну) „апликацију“ за приступ својим подацима. Једном, око 3 минута:'));
  c.appendChild(h('ol.steps',
    h('li', 'Отвори developer.spotify.com/dashboard и пријави се својим Spotify налогом.'),
    h('li', 'Create app. Назив и опис по жељи (без речи „Spotify“).'),
    h('li', h('span', 'Redirect URI — копирај ово:'), copyField(SP.redirectUri())),
    h('li', 'Под „Which API/SDKs“ штиклирај Web API, прихвати услове, Save.'),
    h('li', 'У Settings копирај Client ID и налепи га испод.'),
    h('li', 'Ако се не пријављујеш налогом са којим си направио апликацију: User Management → додај тај налог (име и мејл).')));
  c.appendChild(h('div.btn-row', btn('Отвори Spotify Dashboard', () => openExternal('https://developer.spotify.com/dashboard'), 'ghost')));
  c.appendChild(h('div.field', h('label', 'Client ID'), id));
  c.appendChild(h('div.btn-row', busyBtn('Пријави се на Spotify', async () => {
    Settings.set('clientId', id.value.trim());
    await SP.login();
  })));
  c.appendChild(cardNote('Од фебруара 2026. Spotify за овакве апликације тражи Premium налог власника и дозвољава до 5 корисника.'));
  const redirect = h('input', { type: 'text', value: Settings.get('redirectUri'), placeholder: SP.defaultRedirect() });
  redirect.addEventListener('change', () => { Settings.set('redirectUri', redirect.value.trim()); });
  c.appendChild(h('details', h('summary', 'Напредно'), h('div.field', h('label', 'Други Redirect URI (обично не треба)'), redirect)));
  return c;
}

function toggleRow(label, key, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!Settings.get(key) });
  input.addEventListener('change', () => { Settings.set(key, input.checked); onChange && onChange(input.checked); });
  return h('label.toggle', h('span', label), input, h('span.switch'));
}

function jsonSettings() {
  const c = card('Spotify извоз (цела историја)');
  c.id = 'set-json';
  c.appendChild(cardNote('„Extended streaming history“ садржи свако слушање од отварања налога. Затражи га на spotify.com → Account → Privacy settings → Download your data. Стиже мејлом за неколико дана. Увези ZIP или све JSON фајлове одједном; поновни увоз не прави дупликате.'));
  c.appendChild(h('div.btn-row', importButton('Увези ZIP / JSON'),
    btn('Затражи извоз', () => openExternal('https://www.spotify.com/account/privacy/'), 'ghost')));
  const imports = Store.meta.imports || [];
  if (imports.length) {
    c.appendChild(h('div.list', imports.slice().reverse().map(im => row({
      title: fmtDate(im.at, true) + ' · ' + countOf(im.files, 'фајл', 'фајла', 'фајлова'),
      sub: fmtDate(im.from) + ' – ' + fmtDate(im.to) + (im.extended ? '' : ' · кратка историја'),
      value: '+' + fmtInt(im.added),
    }))));
    c.appendChild(btn('Обриши увезене JSON податке', () => confirmSheet('Брисање', 'Бришу се сва слушања из Spotify извоза. Last.fm и Spotify слушања остају.', 'Обриши',
      async () => { await Store.removeSource(SRC_JSON); App.dataChanged(); App.back(); }), 'ghost danger-text'));
  }
  return c;
}

function lastfmSettings() {
  const c = card('Last.fm');
  c.id = 'set-lastfm';
  c.appendChild(cardNote('Ако Spotify скроблујеш на Last.fm, Слушаоница преузима целу историју одатле. Треба ти корисничко име и бесплатан API кључ (last.fm/api/account/create: попуни назив апликације, остало може празно).'));
  const user = h('input', { type: 'text', value: Settings.get('lastfmUser'), autocomplete: 'off', spellcheck: false });
  const key = h('input', { type: 'text', value: Settings.get('lastfmKey'), autocomplete: 'off', spellcheck: false });
  user.addEventListener('change', () => Settings.set('lastfmUser', user.value.trim()));
  key.addEventListener('change', () => Settings.set('lastfmKey', key.value.trim()));
  c.appendChild(h('div.field', h('label', 'Корисничко име'), user));
  c.appendChild(h('div.field', h('label', 'API кључ'), key));
  const status = h('p.note');
  const st = Store.meta.lastfm;
  if (st && st.last) {
    status.textContent = 'Последња синхронизација ' + fmtAgo(st.last) + '. ' + (st.done ? 'Цела историја је преузета' + (st.oldest ? ' (од ' + fmtDate(st.oldest) + ').' : '.') : 'Старија историја се још преузима' + (st.oldest ? ' (стигло до ' + fmtDate(st.oldest) + ').' : '.'));
  }
  c.appendChild(status);
  c.appendChild(h('div.btn-row',
    btn('Направи API кључ', () => openExternal('https://www.last.fm/api/account/create'), 'ghost'),
    busyBtn('Синхронизуј', async () => {
      Settings.set('lastfmUser', user.value.trim());
      Settings.set('lastfmKey', key.value.trim());
      if (!LF.configured()) { toast('Упиши име и API кључ', true); return; }
      if (Store.meta.demo) { await Store.wipe(); }
      const info = await LF.userInfo();
      status.textContent = 'Налог ' + info.name + ': ' + fmtInt(+info.playcount) + ' скроблова. Преузимам…';
      await Sync.run({ force: true, report: true });
      App.openSettings('lastfm');
    })));
  c.appendChild(toggleRow('Преузимај нова слушања при покретању', 'lastfmAuto'));
  if (st) {
    c.appendChild(btn('Обриши Last.fm податке', () => confirmSheet('Брисање', 'Бришу се слушања која су стигла само са Last.fm-а.', 'Обриши',
      async () => { await Store.removeSource(SRC_LFM); App.dataChanged(); App.back(); }), 'ghost danger-text'));
  }
  return c;
}

/** Plays per year and source, so the user sees which source covers what. */
function coverageCard() {
  const c = card('Шта је покривено');
  if (Store.isEmpty()) { c.appendChild(empty('Још нема података.')); return c; }
  const years = new Map();
  for (const p of Store.plays) {
    const y = new Date(p.t).getFullYear();
    let v = years.get(y);
    if (!v) years.set(y, v = [0, 0, 0, 0]);
    v[0]++;
    if (p.f & SRC_JSON) v[1]++;
    if (p.f & SRC_API) v[2]++;
    if (p.f & SRC_LFM) v[3]++;
  }
  c.appendChild(cardNote('Број слушања по извору. Једно слушање може бити у више извора (тада се рачуна једном). Spotify извоз има предност за време које покрива.'));
  c.appendChild(h('div.table-wrap', h('table.table',
    h('thead', h('tr', h('th', 'Год.'), h('th', 'Укупно'), h('th', 'Извоз'), h('th', 'Spotify'), h('th', 'Last.fm'))),
    h('tbody', [...years].sort((a, b) => b[0] - a[0]).map(([y, v]) => h('tr', h('td', String(y)), v.map(x => h('td', x ? fmtInt(x) : '–'))))))));
  if (Store.coverage.length) {
    c.appendChild(h('p.note', 'Извоз покрива: ' + Store.coverage.map(([a, b]) => fmtDate(a) + ' – ' + fmtDate(b)).join(', ') + '.'));
  }
  return c;
}

function statsSettings() {
  const c = card('Рачунање');
  const min = h('input', { type: 'number', min: 0, max: 300, value: Settings.get('minPlaySec') });
  const gap = h('input', { type: 'number', min: 5, max: 240, value: Settings.get('sessionGapMin') });
  min.addEventListener('change', () => { Settings.set('minPlaySec', Math.max(0, Math.min(300, +min.value || 0))); App.dataChanged(); });
  gap.addEventListener('change', () => { Settings.set('sessionGapMin', Math.max(5, Math.min(240, +gap.value || 30))); App.dataChanged(); });
  c.appendChild(h('div.field', h('label', 'Слушање се рачуна после (секунди)'), min));
  c.appendChild(cardNote('Важи за Spotify извоз, где се зна колико је песма свирала. Spotify и Last.fm сами рачунају тек после око 30 секунди. Минути се увек рачунају сви.'));
  c.appendChild(h('div.field', h('label', 'Сесија се прекида после (минута тишине)'), gap));
  const theme = h('select', [['auto', 'као систем'], ['dark', 'тамна'], ['light', 'светла']].map(([v, l]) => h('option', { value: v, selected: Settings.get('theme') === v }, l)));
  theme.addEventListener('change', () => { Settings.set('theme', theme.value); applyTheme(); });
  c.appendChild(h('div.field', h('label', 'Тема'), theme));
  return c;
}

function groupSettings() {
  const c = card('Групе извођача');
  const input = h('input', { type: 'text', value: Settings.get('tagNames').join(', ') });
  input.addEventListener('change', () => {
    Settings.set('tagNames', [...new Set(input.value.split(',').map(x => x.trim()).filter(Boolean))].slice(0, 8));
    Stats.cache.clear();
  });
  c.appendChild(cardNote('Називи група одвојени зарезом, нпр. „ExYu, Рок, Класика“. Извођаче разврставаш на њиховој страни или у брзом разврставању.'));
  c.appendChild(h('div.field', h('label', 'Групе'), input));
  c.appendChild(btn('Брзо разврставање', () => App.openTagger(), 'ghost'));
  return c;
}

function dataSettings() {
  const c = card('Подаци');
  c.appendChild(cardNote('Све је сачувано само на овом уређају. Бекап је један фајл са свим слушањима и подешеним групама (без Spotify и Last.fm пријаве).'));
  const restoreInput = h('input', { type: 'file', accept: '.gz,.json,application/gzip,application/json', style: { display: 'none' } });
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files[0];
    if (!f) return;
    try { await importBackup(f); App.dataChanged(); toast('Бекап је враћен'); App.back(); }
    catch (e) { toast(e.message, true); }
  });
  c.appendChild(h('div.btn-grid',
    busyBtn('Сачувај бекап', () => exportBackup(), 'ghost'),
    btn('Врати бекап', () => { restoreInput.value = ''; restoreInput.click(); }, 'ghost'),
    busyBtn('Извоз у CSV (Ексел)', () => exportCsv(), 'ghost'),
    btn('Обриши све', () => confirmSheet('Брисање свега', 'Сва слушања и подешене групе биће обрисани са овог уређаја. Ово се не може опозвати.', 'Обриши све',
      async () => { await Store.wipe(); App.dataChanged(); App.back(); }), 'ghost danger-text')));
  c.appendChild(restoreInput);
  c.appendChild(h('p.note', fmtInt(Store.plays.length) + ' слушања · ' + fmtInt(Store.tracks.length) + ' песама · ' + fmtInt(Store.artists.length) + ' извођача у бази.'));
  return c;
}

function aboutCard() {
  const c = card('О апликацији');
  const ver = IS_APP && AppAndroid.getVersion ? AppAndroid.getVersion() : 'веб верзија';
  c.appendChild(h('p', 'Слушаоница ' + ver));
  if (IS_APP) c.appendChild(btn('Провери ажурирања', () => AppAndroid.checkForUpdate(), 'ghost'));
  c.appendChild(cardNote('Подаци о слушању: Spotify и Last.fm. Апликација није повезана са Spotify-јем.'));
  return c;
}

function applyTheme() {
  const t = Settings.get('theme');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
