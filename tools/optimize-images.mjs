#!/usr/bin/env node
/* optimize-images.mjs · turns camera photos into web-sized WebP files.

   A phone photo is 3 to 10 MB; the page shows it a few hundred pixels wide. This script resizes
   each photo to the largest size the site actually displays and saves it as WebP (typically
   100 to 300 KB), then prints the <img> tag to paste, with the right width and height.

   Use it whenever you add a photo:
     npm install --no-save sharp                 (once)
     node tools/optimize-images.mjs travel/map/lisbon.jpg hobbies/climbing.jpg
   Each input file is replaced by a .webp next to it (the original is deleted with --replace,
   otherwise it is left for you to move out of the repository).

   Sizes: longest edge 1600 px by default; 1200 px in travel/map/ (map pop-ups); 256 px in logos/. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2), replace = args.includes('--replace'), quiet = args.includes('--quiet');
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('usage: node tools/optimize-images.mjs [--replace] <image> [...]'); process.exit(1); }

const longEdge = (f) => /(^|\/)logos\//.test(f) ? 256 : /(^|\/)travel\/map\//.test(f) ? 1200 : 1600;
const out = [];
for (const f of files) {
  const dst = f.replace(/\.(jpe?g|png)$/i, '.webp'), max = +(process.env.MAX_EDGE || 0) || longEdge(f);
  const src = sharp(f, { failOn: 'none' }).rotate();                 // honour the camera's orientation tag
  const meta = await src.metadata(), flat = /(^|\/)logos\//.test(f) || meta.hasAlpha;
  const img = src.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  const info = await (flat ? img.webp({ quality: 90, alphaQuality: 100, effort: 6 }) : img.webp({ quality: 78, effort: 6, smartSubsample: true })).toFile(dst + '.tmp');
  fs.renameSync(dst + '.tmp', dst);
  if (replace && path.resolve(dst) !== path.resolve(f)) fs.unlinkSync(f);
  out.push({ from: f, to: dst, width: info.width, height: info.height, bytes: info.size });
  if (!quiet) console.log(`${f} → ${dst}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)} KB\n  <img src="${dst}" width="${info.width}" height="${info.height}" alt="" loading="lazy" decoding="async" />`);
}
if (process.env.MANIFEST) fs.writeFileSync(process.env.MANIFEST, JSON.stringify(out, null, 1));
