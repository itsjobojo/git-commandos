#!/usr/bin/env node
// Generates the optimized, committed image set for site/public/ from the
// source screenshots and logo. macOS-only (uses `sips`) — run locally, not in CI.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const screenshotsDir = join(root, 'screenshots');
const siteDir = join(root, 'site', 'public');
const shotsDir = join(siteDir, 'shots');

try {
  execFileSync('sips', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('sips not found — this script requires macOS. Skipping image build.');
  process.exit(1);
}

mkdirSync(shotsDir, { recursive: true });

function resize(src, dest, width, quality) {
  copyFileSync(src, dest);
  execFileSync('sips', [
    '-Z', String(width),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(quality),
    dest,
  ], { stdio: 'ignore' });
}

const shots = readdirSync(screenshotsDir).filter((f) => f.endsWith('.jpg'));
for (const file of shots) {
  const src = join(screenshotsDir, file);
  const base = file.replace(/\.jpg$/, '');
  resize(src, join(shotsDir, `${base}-1280.jpg`), 1280, 55);
  resize(src, join(shotsDir, `${base}-640.jpg`), 640, 55);
  console.log(`shots: ${file}`);
}

// Logo — pass through as-is, it's already a small transparent webp.
copyFileSync(join(root, 'public', 'gcms-logo.webp'), join(siteDir, 'logo.webp'));
console.log('logo: gcms-logo.webp -> logo.webp');

// Favicon — the transparent hero logo, square-cropped and downsized. sips can
// decode webp and preserves alpha through the PNG re-encode.
const faviconTmp = join(siteDir, 'favicon.png');
execFileSync('sips', ['-s', 'format', 'png', join(root, 'public', 'gcms-logo.webp'), '--out', faviconTmp], { stdio: 'ignore' });
execFileSync('sips', ['-c', '1024', '1024', '-Z', '256', faviconTmp], { stdio: 'ignore' });
console.log('favicon: gcms-logo.webp -> favicon.png (256x256, transparent)');

// OG image — wide screenshot, no letterboxing needed at 1200w.
const ogSrc = join(screenshotsDir, '02-city.jpg');
const ogDest = join(siteDir, 'og.jpg');
resize(ogSrc, ogDest, 1200, 72);
console.log('og: 02-city.jpg -> og.jpg');

let total = 0;
for (const f of readdirSync(shotsDir)) total += statSync(join(shotsDir, f)).size;
for (const f of ['logo.webp', 'favicon.png', 'og.jpg']) total += statSync(join(siteDir, f)).size;
console.log(`\nTotal site/public weight: ${(total / 1024 / 1024).toFixed(2)} MB`);
