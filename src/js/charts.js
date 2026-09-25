/* ---------- charts.js: small SVG/HTML chart kit ----------
Marks follow one spec: bars ≤ 24px with a 4px rounded data end, 2px lines, recessive hairline
grid, categorical colors in fixed order (--c1…--c8), sequential blue ramp (--q0…--q6) for heat.
Every chart has a hover/touch tooltip; values also appear in lists/tables next to the charts.
*/

const Tip = {
  el: null,
  show(rows, x, y) {
    if (!this.el) this.el = document.body.appendChild(h('div.tip'));
    clear(this.el);
    for (const r of rows) {
      if (typeof r === 'string') this.el.appendChild(h('div.tip-title', r));
      else this.el.appendChild(h('div.tip-row', r.color ? h('span.tip-key', { style: { background: r.color } }) : null,
        h('b', r.value), r.label ? h('span', r.label) : null));
    }
    this.el.style.display = 'block';
    const w = this.el.offsetWidth, hh = this.el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = x - w / 2;
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = y - hh - 14;
    if (top < 8) top = y + 18;
    this.el.style.left = left + 'px';
    this.el.style.top = top + 'px';
  },
  hide() { if (this.el) this.el.style.display = 'none'; },
};
document.addEventListener('scroll', () => Tip.hide(), true);

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const OTHER_COLOR = 'var(--c-other)';

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function chartBox(container, height) {
  clear(container);
  container.classList.add('chart');
  const W = Math.max(260, container.clientWidth || 320);
  const svg = s('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img' });
  container.appendChild(svg);
  return { W, H: height, svg };
}

function yAxis(svg, ticks, x0, x1, yOf, fmt) {
  const g = s('g', { class: 'axis' });
  for (const t of ticks) {
    const y = Math.round(yOf(t)) + 0.5;
    g.appendChild(s('line', { x1: x0, x2: x1, y1: y, y2: y, class: t === 0 ? 'baseline' : 'grid' }));
    g.appendChild(s('text', { x: x0 - 6, y: y + 4, 'text-anchor': 'end' }, fmt(t)));
  }
  svg.appendChild(g);
}

function xLabels(svg, labels, xOf, y, W, minGap = 56) {
  const g = s('g', { class: 'axis' });
  let lastX = -Infinity;
  const n = labels.length;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - 40) / minGap))));
  for (let i = 0; i < n; i += step) {
    const x = xOf(i);
    if (x - lastX < minGap * 0.8) continue;
    g.appendChild(s('text', { x, y, 'text-anchor': 'middle' }, labels[i]));
    lastX = x;
  }
  svg.appendChild(g);
}

function barPath(x, y, w, h0, r) {
  // Rounded top (data end), square at the baseline.
  if (h0 <= 0) return '';
  r = Math.min(r, w / 2, h0);
  return `M${x},${y + h0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h0}Z`;
}

/**
 * Time series: columns when they fit, otherwise an area line.
 * opts: {labels (short axis labels), full (tooltip labels), values, fmt, height, color, onPick(i)}
 */
function chartSeries(container, opts) {
  const { labels, values } = opts;
  const full = opts.full || labels;
  const fmt = opts.fmt || fmtInt;
  const height = opts.height || 190;
  const { W, H, svg } = chartBox(container, height);
  const L = 44, R = 10, T = 12, B = 24;
  const n = values.length;
  const max = Math.max(0, ...values);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const pw = W - L - R, ph = H - T - B;
  const yOf = v => T + ph - (v / top) * ph;
  yAxis(svg, ticks, L, W - R, yOf, v => opts.axisFmt ? opts.axisFmt(v) : fmtCompact(v));
  const band = pw / Math.max(1, n);
  const xOf = i => L + band * (i + 0.5);
  const color = opts.color || COLORS[0];
  const asBars = band >= 4;
  const marks = [];
  if (asBars) {
    const bw = Math.min(24, Math.max(2, band - 2));
    const g = s('g');
    values.forEach((v, i) => {
      const y = yOf(v);
      const p = s('path', { d: barPath(xOf(i) - bw / 2, y, bw, T + ph - y, bw >= 8 ? 4 : 1), style: `fill:${color}`, class: 'mark' });
      g.appendChild(p);
      marks.push(p);
    });
    svg.appendChild(g);
  } else {
    let d = '';
    values.forEach((v, i) => { d += (i ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + yOf(v).toFixed(1); });
    svg.appendChild(s('path', { d: d + `L${xOf(n - 1)},${T + ph}L${xOf(0)},${T + ph}Z`, style: `fill:${color};opacity:.14` }));
    svg.appendChild(s('path', { d, class: 'line', style: `stroke:${color}` }));
  }
  xLabels(svg, labels, xOf, H - 6, W);
  // Hover layer: the whole plot, snapping to the nearest bucket.
  const cross = s('line', { class: 'cross', y1: T, y2: T + ph, x1: -10, x2: -10 });
  const dot = s('circle', { r: 4, class: 'dot', cx: -10, cy: -10, style: `fill:${color}` });
  if (!asBars) { svg.appendChild(cross); svg.appendChild(dot); }
  const hit = s('rect', { x: L, y: T, width: pw, height: ph + B, class: 'hit' });
  svg.appendChild(hit);
  let active = -1;
  const pick = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / band)));
    if (i !== active) {
      if (active >= 0 && marks[active]) marks[active].classList.remove('on');
      active = i;
      if (marks[i]) marks[i].classList.add('on');
    }
    if (!asBars) {
      cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i));
      dot.setAttribute('cx', xOf(i)); dot.setAttribute('cy', yOf(values[i]));
    }
    Tip.show([full[i], { value: fmt(values[i]) }], r.left + xOf(i), r.top + yOf(values[i]));
    return i;
  };
  hit.addEventListener('pointermove', pick);
  hit.addEventListener('pointerdown', pick);
  hit.addEventListener('pointerleave', () => {
    Tip.hide();
    if (active >= 0 && marks[active]) marks[active].classList.remove('on');
    cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); dot.setAttribute('cx', -10);
    active = -1;
  });
  if (opts.onPick) hit.addEventListener('click', e => opts.onPick(pick(e)));
}

/** Several lines on one axis. opts: {series: [{name, values, color}], labelOf(i), xLabels: [{i, text}], fmt, height} */
function chartLines(container, opts) {
  const height = opts.height || 220;
  const wrap = container;
  clear(wrap);
  if (opts.series.length > 1) wrap.appendChild(legend(opts.series.map((sr, k) => ({ name: sr.name, color: sr.color || COLORS[k % 8], line: true }))));
  const holder = wrap.appendChild(h('div'));
  const { W, H, svg } = chartBox(holder, height);
  const L = 44, R = 36, T = 12, B = 24;
  const n = Math.max(...opts.series.map(sr => sr.values.length));
  const max = Math.max(0, ...opts.series.map(sr => Math.max(0, ...sr.values)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const pw = W - L - R, ph = H - T - B;
  const xOf = i => L + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const yOf = v => T + ph - (v / top) * ph;
  const fmt = opts.fmt || fmtInt;
  yAxis(svg, ticks, L, W - R, yOf, v => fmtCompact(v));
  const g = s('g', { class: 'axis' });
  for (const xl of opts.xLabels || []) g.appendChild(s('text', { x: xOf(xl.i), y: H - 6, 'text-anchor': 'middle' }, xl.text));
  svg.appendChild(g);
  opts.series.forEach((sr, k) => {
    const color = sr.color || COLORS[k % 8];
    let d = '';
    sr.values.forEach((v, i) => { d += (i ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + yOf(v).toFixed(1); });
    svg.appendChild(s('path', { d, class: 'line', style: `stroke:${color}` }));
    const last = sr.values.length - 1;
    if (last >= 0) {
      svg.appendChild(s('circle', { cx: xOf(last), cy: yOf(sr.values[last]), r: 4, class: 'dot', style: `fill:${color}` }));
      if (opts.endLabels) svg.appendChild(s('text', { x: xOf(last) + 7, y: yOf(sr.values[last]) + 4, class: 'endlabel' }, sr.name));
    }
  });
  const cross = s('line', { class: 'cross', y1: T, y2: T + ph, x1: -10, x2: -10 });
  svg.appendChild(cross);
  const hit = s('rect', { x: L, y: T, width: pw, height: ph, class: 'hit' });
  svg.appendChild(hit);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - L) / pw) * (n - 1))));
    cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i));
    const rows = [opts.labelOf ? opts.labelOf(i) : String(i)];
    opts.series.forEach((sr, k) => {
      if (i < sr.values.length) rows.push({ color: sr.color || COLORS[k % 8], value: fmt(sr.values[i]), label: sr.name });
    });
    Tip.show(rows, r.left + xOf(i), e.clientY - 10);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { Tip.hide(); cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); });
}

/** 100% stacked area. opts: {labels, short, series: [{name, values (shares)}]} */
function chartShare(container, opts) {
  clear(container);
  const series = opts.series;
  const colorOf = k => (series[k].name === 'Остали' ? OTHER_COLOR : COLORS[k % 8]);
  container.appendChild(legend(series.map((sr, k) => ({ name: sr.name, color: colorOf(k) }))));
  const holder = container.appendChild(h('div'));
  const { W, H, svg } = chartBox(holder, opts.height || 220);
  const L = 36, R = 10, T = 8, B = 24;
  const n = opts.labels.length;
  const pw = W - L - R, ph = H - T - B;
  const xOf = i => L + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const yOf = v => T + ph - v * ph;
  yAxis(svg, [0, 0.25, 0.5, 0.75, 1], L, W - R, yOf, v => Math.round(v * 100) + '%');
  const base = new Array(n).fill(0);
  series.forEach((sr, k) => {
    const lower = base.slice();
    const upper = base.map((b, i) => b + sr.values[i]);
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + yOf(upper[i]).toFixed(1);
    for (let i = n - 1; i >= 0; i--) d += 'L' + xOf(i).toFixed(1) + ',' + yOf(lower[i]).toFixed(1);
    svg.appendChild(s('path', { d: d + 'Z', class: 'area', style: `fill:${colorOf(k)}` }));
    for (let i = 0; i < n; i++) base[i] = upper[i];
  });
  xLabels(svg, opts.short, xOf, H - 6, W);
  const cross = s('line', { class: 'cross', y1: T, y2: T + ph, x1: -10, x2: -10 });
  svg.appendChild(cross);
  const hit = s('rect', { x: L, y: T, width: pw, height: ph, class: 'hit' });
  svg.appendChild(hit);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - L) / pw) * (n - 1))));
    cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i));
    const rows = [opts.labels[i]];
    series.forEach((sr, k) => rows.push({ color: colorOf(k), value: fmtPct(sr.values[i]), label: sr.name }));
    Tip.show(rows, r.left + xOf(i), e.clientY - 10);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { Tip.hide(); cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); });
}

function legend(items) {
  return h('div.legend', items.map(it => h('span.legend-item',
    h('span', { class: it.line ? 'key-line' : 'key-box', style: { background: it.color } }), it.name)));
}

/** Sequential color step 0…6 for a value relative to max (0 = empty). */
function heatStep(v, max) {
  if (!v || !max) return 0;
  return Math.max(1, Math.min(6, Math.ceil((v / max) * 6)));
}
function heatLegend(max, fmt) {
  return h('div.heat-legend', h('span', 'мање'), [1, 2, 3, 4, 5, 6].map(k => h('i', { style: { background: `var(--q${k})` } })), h('span', 'више'));
}

/** Weekday × hour heat map. m: 7×24 values. */
function chartHourWeek(container, m, fmt) {
  clear(container);
  container.classList.add('chart');
  const max = Math.max(...m.map(r => Math.max(...r)));
  const grid = h('div.hw');
  grid.appendChild(h('span'));
  for (let hh = 0; hh < 24; hh++) grid.appendChild(h('span.hw-h', hh % 3 === 0 ? String(hh) : ''));
  m.forEach((row, w) => {
    grid.appendChild(h('span.hw-d', WEEKDAYS_SHORT[w]));
    row.forEach((v, hh) => {
      const cell = h('span.hw-c', { style: { background: `var(--q${heatStep(v, max)})` } });
      const show = e => {
        const r = cell.getBoundingClientRect();
        Tip.show([WEEKDAYS[w] + ', ' + hh + ':00–' + (hh + 1) + ':00', { value: fmt(v) }], r.left + r.width / 2, r.top);
      };
      cell.addEventListener('pointerenter', show);
      cell.addEventListener('pointerdown', show);
      cell.addEventListener('pointerleave', () => Tip.hide());
      grid.appendChild(cell);
    });
  });
  container.appendChild(grid);
  container.appendChild(heatLegend());
}

/** Calendar for one year: 12 rows (months) × 31 columns (days). dayMap: Map(day → {plays, ms}). */
function chartCalendar(container, year, dayMap, metric, onDay) {
  clear(container);
  container.classList.add('chart');
  let max = 0;
  const vals = [];
  for (let m = 0; m < 12; m++) {
    const row = [];
    const days = new Date(year, m + 1, 0).getDate();
    for (let d = 1; d <= 31; d++) {
      if (d > days) { row.push(null); continue; }
      const dn = Math.floor(Date.UTC(year, m, d) / DAY);
      const v = dayMap.get(dn);
      const x = v ? (metric === 'ms' ? v.ms : v.plays) : 0;
      if (x > max) max = x;
      row.push({ dn, x });
    }
    vals.push(row);
  }
  const grid = h('div.cal');
  grid.appendChild(h('span'));
  for (let d = 1; d <= 31; d++) grid.appendChild(h('span.cal-h', d % 5 === 0 || d === 1 ? String(d) : ''));
  vals.forEach((row, m) => {
    grid.appendChild(h('span.cal-m', MONTHS_SHORT[m]));
    row.forEach(c => {
      if (!c) { grid.appendChild(h('span.cal-x')); return; }
      const wd = weekdayOfDay(c.dn);
      const cell = h('span.cal-c' + (wd >= 5 ? '.we' : ''), { style: { background: `var(--q${heatStep(c.x, max)})` } });
      const show = () => {
        const r = cell.getBoundingClientRect();
        Tip.show([WEEKDAYS[wd] + ', ' + fmtDay(c.dn), { value: metric === 'ms' ? fmtDur(c.x) : countOf(c.x, 'слушање', 'слушања', 'слушања') }], r.left + r.width / 2, r.top);
      };
      cell.addEventListener('pointerenter', show);
      cell.addEventListener('pointerdown', show);
      cell.addEventListener('pointerleave', () => Tip.hide());
      if (onDay) cell.addEventListener('click', () => onDay(c.dn));
      grid.appendChild(cell);
    });
  });
  container.appendChild(grid);
  container.appendChild(heatLegend());
}

/** A single 100% bar split into parts, with a legend list under it. items: [{name, value}] */
function chartSplit(container, items, fmt) {
  clear(container);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const shown = items.slice(0, 7);
  const rest = items.slice(7).reduce((a, b) => a + b.value, 0);
  if (rest) shown.push({ name: 'Остало', value: rest, other: true });
  const bar = h('div.split');
  shown.forEach((it, k) => {
    const seg = h('span', { style: { flexGrow: it.value, background: it.other ? OTHER_COLOR : COLORS[k % 8] } });
    const show = () => {
      const r = seg.getBoundingClientRect();
      Tip.show([it.name, { value: fmtPct(it.value / total), label: fmt(it.value) }], r.left + r.width / 2, r.top);
    };
    seg.addEventListener('pointerenter', show);
    seg.addEventListener('pointerdown', show);
    seg.addEventListener('pointerleave', () => Tip.hide());
    bar.appendChild(seg);
  });
  container.appendChild(bar);
  container.appendChild(h('div.split-list', shown.map((it, k) => h('div.split-row',
    h('span.key-box', { style: { background: it.other ? OTHER_COLOR : COLORS[k % 8] } }),
    h('span.grow', it.name), h('b', fmtPct(it.value / total)), h('span.muted', fmt(it.value))))));
}

/** Horizontal histogram bars (HTML). items: [{label, value, sub}] */
function chartHBars(container, items, fmt, color) {
  clear(container);
  const max = Math.max(...items.map(i => i.value), 1);
  container.appendChild(h('div.hbars', items.map(it => h('div.hbar',
    h('span.hbar-label', it.label),
    h('span.hbar-track', h('span.hbar-fill', { style: { width: (it.value / max * 100) + '%', background: color || COLORS[0] } })),
    h('span.hbar-val', fmt(it.value))))));
}

/**
 * Bar chart race: frames [{label, items: [{id, v}]}], nameOf(id), subOf(id).
 * Rows are absolutely positioned and slide to their rank; the bar widths animate.
 */
function chartRace(container, frames, nameOf, subOf) {
  clear(container);
  if (!frames.length) return;
  const ROW = 30, N = Math.max(...frames.map(f => f.items.length));
  const colorOf = new Map();
  let nextColor = 0;
  const title = h('div.race-label');
  const stage = h('div.race', { style: { height: (N * ROW) + 'px' } });
  const rows = new Map();
  const slider = h('input.race-slider', { type: 'range', min: 0, max: frames.length - 1, value: 0 });
  const btn = h('button.btn.small', '▶ Пусти');
  let k = 0, timer = null;
  const render = () => {
    const f = frames[k];
    title.textContent = f.label;
    slider.value = k;
    const max = f.items.length ? f.items[0].v : 1;
    const seen = new Set();
    f.items.forEach((it, rank) => {
      seen.add(it.id);
      let row = rows.get(it.id);
      if (!row) {
        if (!colorOf.has(it.id)) colorOf.set(it.id, COLORS[nextColor++ % 8]);
        row = h('div.race-row', h('span.race-bar', { style: { background: colorOf.get(it.id) } }),
          h('span.race-name', nameOf(it.id)), h('span.race-val'));
        row.style.transform = `translateY(${N * ROW}px)`;
        stage.appendChild(row);
        rows.set(it.id, row);
      }
      row.style.opacity = 1;
      row.style.transform = `translateY(${rank * ROW}px)`;
      row.firstChild.style.width = Math.max(2, (it.v / max) * 100) + '%';
      row.lastChild.textContent = fmtInt(it.v);
    });
    for (const [id, row] of rows) if (!seen.has(id)) { row.style.opacity = 0; row.style.transform = `translateY(${N * ROW}px)`; }
  };
  const stop = () => { clearInterval(timer); timer = null; btn.textContent = '▶ Пусти'; };
  btn.addEventListener('click', () => {
    if (timer) return stop();
    if (k >= frames.length - 1) k = 0;
    btn.textContent = '⏸ Стани';
    timer = setInterval(() => {
      if (!container.isConnected) return stop();
      if (k >= frames.length - 1) return stop();
      k++;
      render();
    }, frames.length > 80 ? 350 : 600);
  });
  slider.addEventListener('input', () => { stop(); k = +slider.value; render(); });
  container.appendChild(h('div.race-top', title, btn));
  container.appendChild(stage);
  container.appendChild(slider);
  k = frames.length - 1;
  render();
}
