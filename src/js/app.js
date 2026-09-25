/* ---------- app.js: navigation, overlays, start-up ---------- */

const TABS = [
  ['overview', 'Преглед', '<path d="M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z"/>'],
  ['time', 'Време', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  ['top', 'Топ', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>'],
  ['analysis', 'Анализа', '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'],
  ['spotify', 'Spotify', '<circle cx="12" cy="12" r="8.5"/><path d="M8 10c2.6-.8 5.4-.6 8 .8M8.6 13.2c2-.6 4.2-.4 6.2.7M9.2 16c1.5-.4 3-.3 4.4.4"/>'],
];
function icon(paths) {
  return h('span.ico', { html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>' });
}

const App = {
  tab: lsGet('tab', 'overview'),
  period: lsGet('period', { kind: 'all' }),
  state: lsGet('viewState', {}),
  overlays: [],
  backStack: [],

  range() { return resolvePeriod(this.period); },
  sub(view, defaults) {
    this.state[view] = Object.assign({}, defaults, this.state[view] || {});
    return this.state[view];
  },
  setSub(view, patch) {
    Object.assign(this.state[view] || (this.state[view] = {}), patch);
    lsSet('viewState', this.state);
    this.renderKeepScroll();
  },
  setPeriod(p) {
    this.period = p;
    lsSet('period', p);
    this.render();
    this.refreshOverlays();
  },
  go(tab, patch) {
    if (patch) Object.assign(this.state[tab] || (this.state[tab] = {}), patch);
    this.tab = tab;
    lsSet('tab', tab);
    this.closeAllOverlays();
    this.render();
    window.scrollTo(0, 0);
  },

  render() {
    const view = $('#view');
    clear(view);
    Tip.hide();
    const pb = $('#period-bar');
    clear(pb);
    const showPeriod = !Store.isEmpty() && this.tab !== 'spotify';
    if (showPeriod) pb.appendChild(periodBar());
    pb.style.display = showPeriod ? '' : 'none';
    try {
      view.appendChild(Views[this.tab]());
    } catch (e) {
      console.error(e);
      view.appendChild(h('div.view', h('p.warn', 'Грешка у приказу: ' + e.message)));
    }
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
  },
  renderKeepScroll() {
    const y = window.scrollY;
    this.render();
    window.scrollTo(0, y);
  },
  dataChanged() {
    Stats.cache.clear();
    this.render();
    this.refreshOverlays();
  },

  /* ---------- overlays (detail pages, settings) ---------- */

  openOverlay(title, build) {
    const body = h('div.ov-body');
    const el = h('div.overlay',
      h('header.ov-head', btn('←', () => this.back(), 'icon ghost'), h('b.ov-title', title)),
      body);
    const ov = { el, body, build, title };
    const fill = () => {
      clear(body);
      try { body.appendChild(build()); } catch (e) { console.error(e); body.appendChild(h('p.warn', e.message)); }
    };
    ov.fill = fill;
    fill();
    $('#overlay-root').appendChild(el);
    this.overlays.push(ov);
    document.body.classList.add('has-overlay');
    this.pushBack(() => this.closeTop());
    requestAnimationFrame(() => el.classList.add('in'));
  },
  closeTop() {
    const ov = this.overlays.pop();
    if (!ov) return;
    Tip.hide();
    ov.el.classList.remove('in');
    setTimeout(() => ov.el.remove(), 200);
    if (!this.overlays.length) document.body.classList.remove('has-overlay');
  },
  closeAllOverlays() {
    while (this.overlays.length) { this.closeTop(); this.backStack.pop(); }
    this.disarm();
  },
  refreshOverlays() { for (const ov of this.overlays) ov.fill(); },

  /**
   * Back button (Android back, browser back): closes the newest sheet or overlay.
   * The web version keeps one extra history entry while anything is open.
   */
  pushBack(fn) {
    this.backStack.push(fn);
    // While a history.back() is still in flight, the popstate handler re-arms instead.
    if (!IS_APP && !this.armed && !this.ignorePop) { history.pushState({ overlay: 1 }, ''); this.armed = true; }
  },
  popBack(fn) {
    const i = this.backStack.lastIndexOf(fn);
    if (i >= 0) this.backStack.splice(i, 1);
    this.disarm();
  },
  disarm() {
    if (!IS_APP && this.armed && !this.backStack.length) { this.armed = false; this.ignorePop = true; history.back(); }
  },
  /** Returns true if something was closed. */
  back() {
    const fn = this.backStack.pop();
    if (!fn) return false;
    fn();
    this.disarm();
    return true;
  },

  openDetail(kind, id) {
    const title = { track: 'Песма', artist: 'Извођач', album: 'Албум' }[kind];
    this.openOverlay(title, () => kind === 'track' ? trackDetail(id) : kind === 'artist' ? artistDetail(id) : albumDetail(id));
  },
  openDay(day) { this.openOverlay(WEEKDAYS[weekdayOfDay(day)] + ', ' + fmtDay(day), () => dayDetail(day)); },
  openWrapped() { this.openOverlay('Мој преглед', () => wrappedView()); },
  openTagger() { this.openOverlay('Групе извођача', () => taggerView()); },
  openSettings(focus) {
    if (this.overlays.length && this.overlays[this.overlays.length - 1].title === 'Подешавања') {
      const ov = this.overlays[this.overlays.length - 1];
      ov.build = () => settingsView(focus);
      ov.fill();
      return;
    }
    this.openOverlay('Подешавања', () => settingsView(focus));
  },

  /* ---------- start ---------- */

  async init() {
    applyTheme();
    const root = $('#app-root');
    $('#settings-btn').addEventListener('click', () => this.openSettings());
    $('#sync-btn').addEventListener('click', () => Sync.run({ force: true, report: true }));
    const nav = $('.tabs');
    for (const [id, label, paths] of TABS) {
      nav.appendChild(h('button', { type: 'button', 'data-tab': id, onclick: () => this.go(id) }, icon(paths), h('span', label)));
    }
    Sync.onChange(() => {
      $('#sync-btn').classList.toggle('spin', Sync.busy);
      $('#sync-status').textContent = Sync.busy ? Sync.status : '';
    });
    window.addEventListener('popstate', () => {
      if (this.ignorePop) {
        this.ignorePop = false;
        if (this.backStack.length && !this.armed) { history.pushState({ overlay: 1 }, ''); this.armed = true; }
        return;
      }
      this.armed = false;
      const fn = this.backStack.pop();
      if (fn) fn();
      if (this.backStack.length) { history.pushState({ overlay: 1 }, ''); this.armed = true; }
    });
    window.onNativeBack = () => this.back();
    window.onNativeAuth = () => this.checkAuth();
    window.onNativeResume = () => { if (Date.now() - (Sync.lastRun || 0) > 60000) Sync.run(); };
    window.addEventListener('resize', debounce(() => { if (!this.overlays.length) this.renderKeepScroll(); else this.refreshOverlays(); }, 250));

    try {
      await Store.load();
    } catch (e) {
      console.error(e);
      toast('База не може да се отвори: ' + e.message, true);
    }
    root.classList.add('ready');
    this.render();
    if (IS_APP && AppAndroid.ready) AppAndroid.ready();
    await this.checkAuth();
    setTimeout(() => Sync.run(), 800);
    setInterval(() => { if (!document.hidden && SP.loggedIn()) Sync.run(); }, 5 * 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - (Sync.lastRun || 0) > 5 * 60000) Sync.run();
    });
  },

  /** Finishes a Spotify login that came back to the page (web) or the app (Android). */
  async checkAuth() {
    let query = '';
    if (IS_APP) {
      const url = AppAndroid.takeAuthRedirect();
      if (url) query = url.slice(url.indexOf('?'));
    } else if (/[?&](code|error)=/.test(location.search) && /[?&]state=/.test(location.search)) {
      query = location.search;
      history.replaceState(null, '', location.pathname);
    }
    if (!query) return;
    try {
      await SP.finishLogin(query);
      toast('Spotify је повезан');
      // Spotify keeps only the last 50 plays, so background logging starts on by default.
      if (IS_APP) { Settings.set('bgSync', true); AppAndroid.setBackgroundSync(true); }
      if (Store.meta.demo) await Store.wipe();
      this.render();
      await Sync.run({ force: true });
    } catch (e) {
      toast(e.message, true);
    }
  },
};

App.init();
