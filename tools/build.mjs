// Builds index.html from src/ (one self-contained file: the Android app downloads it as a single page).
// Usage: node tools/build.mjs          -> writes index.html
//        node tools/build.mjs --check  -> fails if index.html is not up to date
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Order matters: later files use what earlier ones define.
export const JS_FILES = [
  'util.js', 'store.js', 'importers.js', 'spotify.js', 'sync.js', 'stats.js', 'charts.js',
  'ui.js', 'views.js', 'details.js', 'spotifyview.js', 'settings.js', 'demo.js', 'app.js',
];

export function build() {
  const tpl = readFileSync(join(root, 'src/index.template.html'), 'utf8');
  const css = readFileSync(join(root, 'src/css/app.css'), 'utf8');
  const js = JS_FILES.map(f => readFileSync(join(root, 'src/js', f), 'utf8')).join('\n');
  if (js.includes('</script')) throw new Error('A source file contains "</script", which would end the inline script');
  return tpl.replace('/*CSS*/', () => css.trim()).replace('/*JS*/', () => js.trim());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = build();
  const out = join(root, 'index.html');
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(out, 'utf8'); } catch (e) { /* missing */ }
    if (current !== html) {
      console.error('index.html is out of date. Run: node tools/build.mjs');
      process.exit(1);
    }
    console.log('index.html is up to date');
  } else {
    writeFileSync(out, html);
    console.log('index.html written (' + Math.round(html.length / 1024) + ' KB)');
  }
}
