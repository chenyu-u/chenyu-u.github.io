/* ═══════════════════════════════════════════════════════════════════
   site-prefs.js · Chenyu Li portfolio
   Display settings shared by every page on the site:
     • Theme    — Light / Dark / System   (stored as  cl-theme)
     • Language — English / 简体中文 / Deutsch  (stored as  cl-lang)

   Choices are saved in localStorage, so they follow the visitor to
   every page, and they sync live between the 3D office (laptop.html)
   and the copy of the site running on the laptop screen inside it.

   HOW TO USE ON A PAGE
     <link rel="stylesheet" href="site-prefs.css">
     <script src="site-prefs.js"></script>          ← inside <head>
     <div data-prefs-slot></div>                    ← where the menus go

   HOW TRANSLATION WORKS
     English is the source text written in the HTML. The files
     i18n/zh.js and i18n/de.js map each English block of text (the
     inner HTML of a paragraph, heading, list item, button…) to its
     translation.

     You only ever edit the English. When you push a change, the
     GitHub Action .github/workflows/translate.yml runs
     tools/i18n-sync.mjs, which finds new or edited English text,
     translates it with DeepL and commits it to both files. Until that
     finishes, a new block simply shows in English.

     Names and fixed terms live in i18n/glossary.json. To correct a
     translation, edit it in zh.js / de.js; it will never be
     overwritten. Add  data-no-i18n  to any element that must never
     be translated.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY_THEME = 'cl-theme', KEY_LANG = 'cl-lang';
  var LANGS = {
    en: { label: 'English',  short: 'EN', html: 'en' },
    zh: { label: '简体中文',  short: '中',  html: 'zh-CN' },
    de: { label: 'Deutsch',  short: 'DE', html: 'de' }
  };
  var UI = {
    en: { theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System', lang: 'Language' },
    zh: { theme: '主题', light: '浅色', dark: '深色', system: '跟随系统', lang: '语言' },
    de: { theme: 'Design', light: 'Hell', dark: 'Dunkel', system: 'System', lang: 'Sprache' }
  };

  function load(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var root = document.documentElement;
  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/[^\/]*$/, '') : '';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  var theme = load(KEY_THEME, 'light');
  if (!/^(light|dark|system)$/.test(theme)) theme = 'light';
  var lang = load(KEY_LANG, 'en');
  if (!LANGS[lang]) lang = 'en';

  /* ─────────────────────────── THEME ─────────────────────────── */
  function effTheme() { return theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : theme; }
  function applyTheme() {
    var t = effTheme();
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    try { window.dispatchEvent(new CustomEvent('cl-themechange', { detail: { theme: t } })); } catch (e) {}
    syncUI();
  }
  if (mq) {
    var onMq = function () { if (theme === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  function setTheme(t) { theme = t; save(KEY_THEME, t); applyTheme(); }

  /* ─────────────────────────── LANGUAGE ──────────────────────── */
  window.CL_I18N = window.CL_I18N || {};
  var dict = null;               // current language's table
  var XHTML = 'http://www.w3.org/1999/xhtml';
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, PRE: 1, TEXTAREA: 1, CANVAS: 1, IFRAME: 1, VIDEO: 1, SELECT: 1 };
  var INLINE = { B: 1, STRONG: 1, I: 1, EM: 1, BR: 1, CODE: 1, A: 1, SPAN: 1, SMALL: 1, SUP: 1, SUB: 1, ABBR: 1, KBD: 1, MARK: 1, U: 1, S: 1, Q: 1, WBR: 1 };
  var ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-note'];
  var units = new WeakMap(), texts = new WeakMap(), attrs = new WeakMap();
  var applying = false, observer = null;

  /* patterns for text that is generated with numbers in it */
  var PATTERNS = {
    zh: [
      [/^(\d+) CITIES$/, '$1 座城市'],
      [/^Photo (\d+)$/, '照片 $1'],
      [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{1,2}), (\d{4})$/, function (m, mo, d, y) { return y + '年' + MON[mo] + '月' + d + '日'; }]
    ],
    de: [
      [/^(\d+) CITIES$/, '$1 STÄDTE'],
      [/^Photo (\d+)$/, 'Foto $1'],
      [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{1,2}), (\d{4})$/, function (m, mo, d, y) { return d + '. ' + MON_DE[MON[mo] - 1] + ' ' + y; }]
    ]
  };
  var MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };
  var MON_DE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function hasLetters(s) { return /[A-Za-z]/.test(s); }
  function lookup(key, kind) {
    // Hook used by tools/i18n-sync.mjs to list every English string on a page.
    if (window.__clCollect) window.__clCollect.push([key, kind || 'text']);
    if (lang === 'en' || !dict) return null;
    if (key !== '__re' && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    var p = (PATTERNS[lang] || []).concat(dictPatterns());
    for (var i = 0; i < p.length; i++) {
      if (!p[i][0].test(key)) continue;
      // "{{x}}" in a replacement means: translate x with the table too
      return String(key.replace(p[i][0], p[i][1])).replace(/\{\{(.+?)\}\}/g, function (m, w) {
        return Object.prototype.hasOwnProperty.call(dict, w) ? dict[w] : w;
      });
    }
    return null;
  }
  var reCache = { d: null, list: [] };
  function dictPatterns() {           // optional regex rules shipped in the table as "__re"
    if (reCache.d !== dict) {
      reCache.d = dict;
      reCache.list = (dict && dict.__re || []).map(function (r) { return [new RegExp(r[0]), r[1]]; });
    }
    return reCache.list;
  }

  function inlineOnly(el) {
    var all = el.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (!INLINE[c.tagName] || c.id || c.hasAttribute('data-no-i18n')) return false;
    }
    return true;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var map = attrs.get(el); if (!map) { map = {}; attrs.set(el, map); }
      var cur = el.getAttribute(a), st = map[a];
      if (!st || (cur !== st.applied && cur !== st.orig)) { if (!st && !hasLetters(cur)) continue; st = map[a] = { orig: cur }; }
      var tr = lookup(norm(st.orig), 'text');
      var target = tr == null ? st.orig : tr;
      if (cur !== target) el.setAttribute(a, target);
      st.applied = target;
    }
  }
  function doUnit(el) {
    var st = units.get(el), cur = el.innerHTML;
    if (!st || (cur !== st.applied && cur !== st.orig)) { st = { orig: cur }; units.set(el, st); }
    var tr = lookup(norm(st.orig), 'html');
    var target = tr == null ? st.orig : tr;
    if (cur !== target) el.innerHTML = target;
    st.applied = el.innerHTML;
    var d = el.getElementsByTagName('*');
    for (var i = 0; i < d.length; i++) doAttrs(d[i]);
  }
  function doText(n) {
    var st = texts.get(n), cur = n.nodeValue;
    if (!st || (cur !== st.applied && cur !== st.orig)) { if (!hasLetters(cur)) return; st = { orig: cur }; texts.set(n, st); }
    var tr = lookup(norm(st.orig), 'text'), target = st.orig;
    if (tr != null) { var m = st.orig.match(/^(\s*)[\s\S]*?(\s*)$/); target = m[1] + tr + m[2]; }
    if (cur !== target) n.nodeValue = target;
    st.applied = target;
  }
  function walk(el) {
    if (el.nodeType !== 1 || SKIP[el.tagName] || el.namespaceURI !== XHTML || el.hasAttribute('data-no-i18n')) return;
    doAttrs(el);
    if (units.has(el)) { doUnit(el); return; }
    var direct = false, n;
    for (n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && hasLetters(n.nodeValue)) { direct = true; break; }
    if (direct && inlineOnly(el)) { doUnit(el); return; }
    for (n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (texts.has(n) || hasLetters(n.nodeValue)) doText(n); }
      else if (n.nodeType === 1) walk(n);
    }
  }
  var titleOrig = null;
  function translateAll() {
    applying = true;
    if (titleOrig === null) titleOrig = document.title;
    var t = lookup(norm(titleOrig), 'text'); document.title = t == null ? titleOrig : t;
    if (document.body) walk(document.body);
    if (observer) observer.takeRecords();
    applying = false;
  }
  function inUnit(node) {
    for (var p = node; p && p !== document.body; p = p.parentNode) if (p.nodeType === 1 && units.has(p)) return p;
    return null;
  }
  function excluded(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentNode);
    return !el || !el.closest || !!el.closest('[data-no-i18n], script, style, svg, pre');
  }
  function onMutations(recs) {
    if (applying) return;
    applying = true;
    var seen = new Set();
    recs.forEach(function (r) {
      var t = r.target;
      if (excluded(t)) return;
      if (r.type === 'characterData') {
        var u = inUnit(t.parentNode);
        if (u) { if (!seen.has(u)) { seen.add(u); doUnit(u); } }
        else if (!seen.has(t)) { seen.add(t); doText(t); }
      } else if (r.type === 'attributes') {
        if (t.nodeType === 1) doAttrs(t);
      } else {
        var u2 = inUnit(t);
        if (u2) { if (!seen.has(u2)) { seen.add(u2); doUnit(u2); } return; }
        r.addedNodes.forEach(function (n) {
          if (seen.has(n)) return; seen.add(n);
          if (n.nodeType === 1) walk(n);
          else if (n.nodeType === 3 && n.parentNode && !inUnit(n.parentNode)) walk(n.parentNode);
        });
      }
    });
    observer.takeRecords();
    applying = false;
  }
  function watch(on) {
    if (on && !observer && window.MutationObserver && document.body) {
      observer = new MutationObserver(onMutations);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    } else if (!on && observer) { observer.disconnect(); observer = null; }
  }

  var loading = {};
  function loadDict(l, cb) {
    if (l === 'en' || window.CL_I18N[l]) { cb(); return; }
    if (loading[l]) { loading[l].push(cb); return; }
    loading[l] = [cb];
    var s = document.createElement('script');
    s.src = base + 'i18n/' + l + '.js';
    s.onload = s.onerror = function () { var q = loading[l]; loading[l] = null; q.forEach(function (f) { f(); }); };
    (document.head || root).appendChild(s);
  }
  function applyLang() {
    root.setAttribute('lang', LANGS[lang].html);
    root.setAttribute('data-lang', lang);
    loadDict(lang, function () {
      dict = lang === 'en' ? null : (window.CL_I18N[lang] || null);
      whenReady(function () {
        translateAll();
        watch(lang !== 'en');
        root.classList.remove('sp-pending');
        syncUI();
        try { window.dispatchEvent(new CustomEvent('cl-langchange', { detail: { lang: lang } })); } catch (e) {}
      });
    });
  }
  function setLang(l) { if (!LANGS[l]) return; lang = l; save(KEY_LANG, l); applyLang(); }

  /* ─────────────────────────── MENUS ─────────────────────────── */
  var ICONS = {
    sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    system: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    check: '<svg class="sp-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  };
  var ui = null;

  function buildUI() {
    var slot = document.querySelector('[data-prefs-slot]');
    if (!slot || slot.getAttribute('data-built')) return;
    slot.setAttribute('data-built', '1');
    slot.setAttribute('data-no-i18n', '');
    slot.classList.add('sp-controls');
    slot.innerHTML =
      '<div class="sp-dd" data-dd="theme">' +
        '<button type="button" class="sp-btn sp-theme-btn" aria-haspopup="true" aria-expanded="false"></button>' +
        '<div class="sp-menu" role="menu">' +
          ['light', 'dark', 'system'].map(function (t) {
            return '<button type="button" role="menuitemradio" data-theme-opt="' + t + '">' + ICONS[t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'system'] + '<span></span>' + ICONS.check + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="sp-dd" data-dd="lang">' +
        '<button type="button" class="sp-btn sp-lang-btn" aria-haspopup="true" aria-expanded="false">' + ICONS.globe + '<span class="sp-lang-code"></span></button>' +
        '<div class="sp-menu" role="menu">' +
          Object.keys(LANGS).map(function (l) {
            return '<button type="button" role="menuitemradio" lang="' + LANGS[l].html + '" data-lang-opt="' + l + '"><span class="sp-code">' + LANGS[l].short + '</span><span>' + LANGS[l].label + '</span>' + ICONS.check + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    ui = slot;

    slot.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.classList.contains('sp-btn')) {
        var dd = b.parentNode, open = !dd.classList.contains('open');
        closeMenus();
        if (open) { dd.classList.add('open'); b.setAttribute('aria-expanded', 'true'); var f = dd.querySelector('[aria-checked="true"]'); if (f) f.focus(); }
        return;
      }
      if (b.hasAttribute('data-theme-opt')) setTheme(b.getAttribute('data-theme-opt'));
      if (b.hasAttribute('data-lang-opt')) setLang(b.getAttribute('data-lang-opt'));
      closeMenus();
      var btn = b.closest('.sp-dd').querySelector('.sp-btn'); if (btn) btn.focus();
    });
    slot.addEventListener('keydown', function (e) {
      var dd = e.target.closest('.sp-dd');
      if (!dd) return;
      if (e.key === 'Escape') { closeMenus(); dd.querySelector('.sp-btn').focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = [].slice.call(dd.querySelectorAll('.sp-menu button'));
        if (!dd.classList.contains('open')) return;
        e.preventDefault();
        var i = items.indexOf(document.activeElement);
        i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[i].focus();
      }
    });
    document.addEventListener('click', closeMenus);
    syncUI();
  }
  function closeMenus() {
    if (!ui) return;
    [].forEach.call(ui.querySelectorAll('.sp-dd.open'), function (d) {
      d.classList.remove('open'); d.querySelector('.sp-btn').setAttribute('aria-expanded', 'false');
    });
  }
  function syncUI() {
    if (!ui) return;
    var L = UI[lang] || UI.en, t = effTheme();
    var tb = ui.querySelector('.sp-theme-btn');
    tb.innerHTML = t === 'dark' ? ICONS.moon : ICONS.sun;
    tb.setAttribute('aria-label', L.theme + ': ' + L[theme]);
    tb.title = L.theme;
    var lb = ui.querySelector('.sp-lang-btn');
    lb.querySelector('.sp-lang-code').textContent = LANGS[lang].short;
    lb.setAttribute('aria-label', L.lang + ': ' + LANGS[lang].label);
    lb.title = L.lang;
    [].forEach.call(ui.querySelectorAll('[data-theme-opt]'), function (b) {
      var v = b.getAttribute('data-theme-opt');
      b.querySelector('span').textContent = L[v];
      b.setAttribute('aria-checked', String(v === theme));
    });
    [].forEach.call(ui.querySelectorAll('[data-lang-opt]'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-lang-opt') === lang));
    });
  }

  /* ─────────────────────────── BOOT ──────────────────────────── */
  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // Hide the page for a moment while a non-English table loads, so
  // visitors do not see a flash of English first (never longer than 2 s).
  if (lang !== 'en') {
    var hide = document.createElement('style');
    hide.textContent = 'html.sp-pending body{visibility:hidden}';
    (document.head || root).appendChild(hide);
    root.classList.add('sp-pending');
    setTimeout(function () { root.classList.remove('sp-pending'); }, 2000);
  }

  applyTheme();
  applyLang();
  whenReady(buildUI);

  // Keep every open tab / frame of the site in sync (e.g. the 3D office
  // and the website running on its laptop screen).
  window.addEventListener('storage', function (e) {
    if (e.key === KEY_THEME && e.newValue && e.newValue !== theme) { theme = e.newValue; applyTheme(); }
    if (e.key === KEY_LANG && e.newValue && LANGS[e.newValue] && e.newValue !== lang) { lang = e.newValue; applyLang(); }
  });

  window.CLPrefs = { setTheme: setTheme, setLang: setLang, get theme() { return effTheme(); }, get lang() { return lang; } };
})();
