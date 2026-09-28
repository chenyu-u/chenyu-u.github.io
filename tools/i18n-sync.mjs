#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   tools/i18n-sync.mjs · automatic Chinese + German translations

   WHAT IT DOES
     1. Serves the site locally and opens every page in a headless
        browser (the same way a visitor would), so it sees exactly the
        English text blocks that site-prefs.js translates — including
        text added by JavaScript (map notes, Strava cards, etc.).
     2. Finds English text that has no entry yet in i18n/zh.js or
        i18n/de.js (new or edited text).
     3. Translates only those with the DeepL API, keeping HTML tags,
        names and tool names intact (see i18n/glossary.json).
     4. Adds them to i18n/zh.js and i18n/de.js.

   Existing translations are NEVER overwritten, so any translation you
   fix by hand stays fixed. To force a fresh translation of one block,
   delete its line from the language file and run this again.

   RUN IT
     • Automatically: .github/workflows/translate.yml runs it on every
       push that changes an .html file (needs the DEEPL_API_KEY secret).
     • By hand:  npm install --no-save playwright
                 npx playwright install chromium
                 DEEPL_API_KEY=xxxx node tools/i18n-sync.mjs
       Without a key it only lists what is missing (dry run).

   OPTIONS
     --dry-run        list missing text, translate nothing
     --report-unused  also list translations whose English no longer
                      appears on any page (they are harmless; delete by
                      hand if you want a tidy file)
═══════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(ROOT, 'i18n');
const LANGS = { zh: 'ZH-HANS', de: 'DE' };          // our code → DeepL target_lang
const PAGES = [
  'index.html', 'laptop.html', 'map.html', 'robot-sim.html',
  'project-ema-survey.html', 'project-light-drawer.html', 'project-rc-car.html',
];
const args = new Set(process.argv.slice(2));
const KEY = process.env.DEEPL_API_KEY || '';
const DRY = args.has('--dry-run') || !KEY;

/* ── language files ─────────────────────────────────────────────── */
function readTable(lang) {
  const file = path.join(I18N, `${lang}.js`);
  const src = fs.readFileSync(file, 'utf8');
  const marker = `window.CL_I18N.${lang} = `;
  const start = src.indexOf(marker) + marker.length;
  const end = src.lastIndexOf('}') + 1;
  return { file, head: src.slice(0, start), table: JSON.parse(src.slice(start, end)) };
}
function writeTable({ file, head, table }) {
  fs.writeFileSync(file, head + JSON.stringify(table, null, 1) + ';\n');
}

/* ── strings that need no translation ───────────────────────────── */
const SKIP = [
  /^(\d+) CITIES$/, /^Photo \d+$/,
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d{1,2}, \d{4}$/,
  /^PHASE \w+ · v[\d.]+$/, /^◆ TOO CLOSE TO/, /^◆ EXPORTED \d+ STEPS$/, /^\d+ steps$/,
  /^\d{1,2}:\d{2}( [AP]M)?$/,
];
const plain = (s) => s.replace(/<[^>]+>/g, '');
const GLOSS = JSON.parse(fs.readFileSync(path.join(I18N, 'glossary.json'), 'utf8'));
function needsTranslation(key, lang) {
  // words that come out identical in this language: 'keep' words + names spelled the same
  const same = [...(GLOSS.keep || []), ...Object.entries(GLOSS.names || {}).filter(([en, t]) => (t[lang] || en) === en).map(([en]) => en)];
  if (key === '__re') return false;
  const t = plain(key).replace(/&amp;/g, '&').trim();
  if (!/[A-Za-z]{2,}/.test(t)) return false;           // numbers and symbols only
  // Nothing left to translate once measurements, part codes (L298N, D5, PWM…)
  // and "keep" words from the glossary are taken out? Then leave it in English.
  let rest = t;
  same.sort((a, b) => b.length - a.length).forEach((w) => { rest = rest.split(w).join(' '); });
  rest = rest
    .replace(/[-+~]?\d[\d.,:]*\s*(km|mm|cm|m|s|ms|µs|us|kg|g|V|mA|A|Hz|kHz|GHz|%|°)?(\/km)?\b/g, ' ')
    .replace(/\b[A-Z0-9]*\d[A-Z0-9-]*\b/g, ' ')          // codes containing digits
    .replace(/\b[A-Z]{2,6}\b/g, ' ');                     // acronyms: PWM, GND, CSS…
  if (!/[A-Za-z]{2,}/.test(rest)) return false;
  if (/^[\w.-]+\.(com|ca|io|org)$/i.test(t)) return false; // bare domains
  if (/^\S+@\S+$/.test(t)) return false;                   // e-mail addresses
  return !SKIP.some((re) => re.test(key));
}

/* ── 1. collect English strings from every page ─────────────────── */
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.JPG': 'image/jpeg',
    '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ino': 'text/plain' };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function collect() {
  const { chromium } = await import('playwright');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const found = new Map();                                   // key → { kind, pages:Set }
  for (const page of PAGES) {
    if (!fs.existsSync(path.join(ROOT, page))) continue;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // Browse in Chinese so the translator also watches text added later by JavaScript;
    // the hook in site-prefs.js still reports the original English.
    await ctx.addInitScript(() => {
      try { localStorage.setItem('cl-lang', 'zh'); } catch (e) {}
      window.__clCollect = [];
    });
    const pg = await ctx.newPage();
    try {
      await pg.goto(base + page, { waitUntil: 'load', timeout: 60000 });
      await pg.waitForTimeout(3000);
      // open every map pin so its note is on the page
      await pg.evaluate(async () => {
        for (const m of document.querySelectorAll('.leaflet-marker-icon')) {
          m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
        }
      });
      await pg.waitForTimeout(500);
      const keys = await pg.evaluate(() => window.__clCollect || []);
      for (const [key, kind] of keys) {
        if (!found.has(key)) found.set(key, { kind, pages: new Set() });
        found.get(key).pages.add(page);
      }
      console.log(`  ${page}: ${new Set(keys.map((k) => k[0])).size} text blocks`);
    } catch (e) {
      console.warn(`  ! could not read ${page}: ${e.message}`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  return found;
}

/* ── 2. protect names / tool names, then translate with DeepL ───── */
const glossary = JSON.parse(fs.readFileSync(path.join(I18N, 'glossary.json'), 'utf8'));
const TERMS = [
  ...Object.entries(glossary.names || {}).map(([en, t]) => ({ en, t })),
  ...(glossary.keep || []).map((en) => ({ en, t: null })),
].sort((a, b) => b.en.length - a.en.length);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERM_RE = TERMS.length
  ? new RegExp(`(?<![\\w-])(${TERMS.map((t) => reEsc(esc(t.en))).join('|')})(?![\\w-])`, 'g')
  : null;

function protect(html) {            // wrap glossary terms in <x-keep> (outside tags only)
  if (!TERM_RE) return html;
  return html.split(/(<[^>]+>)/).map((part, i) => (i % 2 ? part : part.replace(TERM_RE, '<x-keep>$1</x-keep>'))).join('');
}
function restore(html, lang) {
  return html.replace(/<x-keep>([\s\S]*?)<\/x-keep>/g, (m, inner) => {
    const term = TERMS.find((t) => esc(t.en) === inner.trim());
    return term && term.t && term.t[lang] ? esc(term.t[lang]) : inner;
  });
}
const tagsOf = (s) => (s.match(/<[^>]+>/g) || []).map((t) => t.replace(/\s+/g, ' '));

async function deepl(texts, lang) {
  const host = process.env.DEEPL_API_URL || (KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com');
  const out = [];
  for (let i = 0; i < texts.length; ) {
    const batch = [];
    let size = 0;
    while (i < texts.length && batch.length < 50 && size + texts[i].length < 100_000) { size += texts[i].length; batch.push(texts[i++]); }
    const body = {
      text: batch, source_lang: 'EN', target_lang: LANGS[lang],
      tag_handling: 'html', ignore_tags: ['x-keep'], preserve_formatting: true,
    };
    if (lang === 'de') body.formality = 'prefer_more';   // polite "Sie", like the rest of the site
    const res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DeepL ${res.status}: ${await res.text()}`);
    const data = await res.json();
    out.push(...data.translations.map((t) => t.text));
  }
  return out;
}

async function translate(items, lang) {
  // items: [{ key, kind }]  → { key: translation }
  const src = items.map(({ key, kind }) => protect(kind === 'html' ? key : esc(key)));
  const got = await deepl(src, lang);
  const result = {};
  items.forEach(({ key, kind }, n) => {
    let t = restore(got[n], lang).replace(/\s+/g, ' ').trim();
    if (lang === 'zh') t = t.replace(/([一-鿿])\s+([一-鿿])/g, '$1$2'); // no stray spaces between Chinese characters
    if (kind === 'html') {
      if (JSON.stringify(tagsOf(t)) !== JSON.stringify(tagsOf(key))) {
        console.warn(`  ! ${lang}: HTML tags changed, left in English → ${key.slice(0, 70)}`);
        return;
      }
    } else {
      t = unesc(t);
    }
    result[key] = t;
  });
  return result;
}

/* ── main ───────────────────────────────────────────────────────── */
console.log('Reading pages…');
const found = await collect();
const tables = Object.fromEntries(Object.keys(LANGS).map((l) => [l, readTable(l)]));
let added = 0;

for (const lang of Object.keys(LANGS)) {
  const t = tables[lang];
  const missing = [...found].filter(([key]) => needsTranslation(key, lang) && !Object.hasOwn(t.table, key))
    .map(([key, v]) => ({ key, kind: v.kind, pages: [...v.pages] }));
  console.log(`\n${lang}: ${missing.length} new or changed text block(s)`);
  for (const m of missing) console.log(`  + [${m.pages.join(', ')}] ${plain(m.key).slice(0, 90)}`);
  if (!missing.length || DRY) continue;

  const done = await translate(missing, lang);
  for (const [k, v] of Object.entries(done)) { t.table[k] = v; added++; }
  writeTable(t);
  console.log(`  wrote ${Object.keys(done).length} translation(s) to i18n/${lang}.js`);
}

if (args.has('--report-unused')) {
  for (const lang of Object.keys(LANGS)) {
    const unused = Object.keys(tables[lang].table).filter((k) => k !== '__re' && !found.has(k));
    console.log(`\n${lang}: ${unused.length} translation(s) not seen on any page (text may only appear while something runs, or it was edited away):`);
    unused.forEach((k) => console.log(`  - ${plain(k).slice(0, 90)}`));
  }
}

if (DRY) console.log(KEY ? '\nDry run: nothing written.' : '\nNo DEEPL_API_KEY set: dry run only, nothing written.');
else console.log(`\nDone. ${added} translation(s) added.`);
