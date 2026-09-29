/**
 * Character-manifest checks, run with `npm run test:manifest`.
 *
 * `public/characters/manifest.json` is the only place hunt characters can point
 * at for camera assets, so a malformed entry would break the AR frame at play
 * time (missing asset, absurd scale, or a path that escapes `public/`).
 */
import { readFileSync } from 'node:fs';

const manifestPath = new URL('../public/characters/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const SAFE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ids = new Set();
for (const entry of manifest.characters) {
  if (SAFE.test(entry.id) === false || ids.has(entry.id)) throw new Error(`bad id ${entry.id}`);
  ids.add(entry.id);
  if (entry.src.startsWith('/characters/') === false || entry.src.includes('..')) {
    throw new Error(`bad src ${entry.src}`);
  }
  if (!(entry.realHeightM > 0 && entry.realHeightM <= 20)) throw new Error('bad realHeightM');
  if (!(entry.aspectRatio > 0 && entry.aspectRatio <= 10)) throw new Error('bad aspectRatio');
  if (/^#[0-9a-f]{6}$/i.test(entry.accent) === false) throw new Error(`bad accent ${entry.accent}`);
}
const treasure = manifest.characters.find(entry => entry.id === 'found-hidden-treasure');
if (!treasure) throw new Error('treasure entry missing');
console.log(
  `manifest ok — ${manifest.characters.length} entries; treasure: ${JSON.stringify(treasure)}`
);
