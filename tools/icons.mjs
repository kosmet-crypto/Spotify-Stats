// Renders the app icons (icons/*.png) from one SVG with the preinstalled Chromium.
// Usage: NODE_PATH=$(npm root -g) node tools/icons.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Five equalizer bars, the tallest in the middle, on a blue→green gradient.
const bars = (scale, cx, cy) => {
  const hs = [0.34, 0.56, 0.8, 0.5, 0.28];
  const w = 0.1 * scale, gap = 0.045 * scale, total = 5 * w + 4 * gap;
  return hs.map((hh, i) => {
    const bh = hh * scale;
    const x = cx - total / 2 + i * (w + gap);
    return `<rect x="${x}" y="${cy + scale * 0.4 - bh}" width="${w}" height="${bh}" rx="${w / 2}" fill="#fff"/>`;
  }).join('');
};
const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#256abf"/><stop offset="1" stop-color="#16a06f"/></linearGradient></defs>
<rect width="${size}" height="${size}" rx="${pad ? 0 : size * 0.22}" fill="url(#g)"/>
${bars(size * (pad ? 0.5 : 0.62), size / 2, size / 2)}
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, pad)}</body></html>`);
  await page.screenshot({ path: join(root, 'icons', name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
