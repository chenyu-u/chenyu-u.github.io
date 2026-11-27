/* site.js · behaviour shared by the pages that use site.css
   (menu on small screens, photo viewer, project filters, running log, travel map, resume request form).
   Each part only runs when its elements are on the page. */
(function () {
  'use strict';
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  /* Inside the 3D office's laptop screen: no door back into the office */
  try { if (window.top !== window.self) document.documentElement.classList.add('in-office'); } catch (e) { document.documentElement.classList.add('in-office'); }

  /* ── menu on small screens ── */
  var menuBtn = $('.menu-btn'), nav = $('.site-nav');
  if (menuBtn && nav) {
    var setOpen = function (o) { nav.classList.toggle('open', o); menuBtn.setAttribute('aria-expanded', o ? 'true' : 'false'); };
    menuBtn.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    addEventListener('resize', function () { if (innerWidth > 900) setOpen(false); });
  }

  /* ── photo viewer ── */
  var lb = null, images = [], current = 0;
  function isVideo(src) { return /\.(mp4|webm|ogv|m4v)(\?.*)?$/i.test(src); }
  function ensureLb() {
    if (lb) return lb;
    lb = document.createElement('div');
    lb.className = 'lb-overlay'; lb.id = 'lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Image viewer');
    lb.setAttribute('data-no-i18n', '');
    lb.innerHTML = '<button class="lb-arrow lb-prev" aria-label="Previous">&#8249;</button><div class="lb-box"><button class="lb-close" aria-label="Close">&#x2715;</button>' +
      '<img class="lb-main" alt="" /><video class="lb-main" controls playsinline preload="metadata" hidden></video><div class="lb-dots"></div><div class="lb-counter"></div></div>' +
      '<button class="lb-arrow lb-next" aria-label="Next">&#8250;</button>';
    document.body.appendChild(lb);
    $('.lb-prev', lb).addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
    $('.lb-next', lb).addEventListener('click', function (e) { e.stopPropagation(); step(1); });
    $('.lb-close', lb).addEventListener('click', closeLb);
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('lb-open')) return;
      if (e.key === 'Escape') closeLb(); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1);
    });
    return lb;
  }
  function stopVideo() { var v = $('video', lb); v.pause(); v.removeAttribute('src'); v.load(); v.hidden = true; }
  function render() {
    var img = $('img.lb-main', lb), vid = $('video', lb), src = images[current];
    if (isVideo(src)) { img.hidden = true; img.removeAttribute('src'); vid.hidden = false; if (vid.getAttribute('src') !== src) { vid.setAttribute('src', src); vid.load(); } vid.play().catch(function () {}); }
    else { stopVideo(); img.hidden = false; img.src = src; img.alt = 'Photo ' + (current + 1); }
    $('.lb-prev', lb).hidden = $('.lb-next', lb).hidden = images.length < 2;
    $('.lb-counter', lb).textContent = images.length > 1 ? (current + 1) + ' / ' + images.length : '';
    var dots = $('.lb-dots', lb); dots.innerHTML = '';
    if (images.length > 1) images.forEach(function (_, i) { var d = document.createElement('span'); d.className = 'lb-dot' + (i === current ? ' active' : ''); d.onclick = function () { current = i; render(); }; dots.appendChild(d); });
  }
  function openLb(imgs, idx) { ensureLb(); images = imgs; current = idx || 0; render(); lb.classList.add('lb-open'); document.body.style.overflow = 'hidden'; $('.lb-close', lb).focus(); }
  function closeLb() { stopVideo(); lb.classList.remove('lb-open'); document.body.style.overflow = ''; }
  function step(d) { current = (current + d + images.length) % images.length; render(); }
  window.__openLb = openLb;
  $$('[data-images]').forEach(function (wrap) {
    var imgs = JSON.parse(wrap.dataset.images);
    wrap.setAttribute('role', 'button'); wrap.tabIndex = 0;
    var open = function (e) {
      var el = e && e.target.closest && e.target.closest('img, video'), idx = 0;
      if (el) {
        var abs = function (u) { try { return new URL(u, document.baseURI).href; } catch (_) { return u; } };
        var src = (el.currentSrc || el.getAttribute('src') || '').replace(/-1200\.webp/, '.webp');   /* the page shows the 1200 px copy; the viewer opens the full-size one */
        idx = imgs.map(abs).indexOf(abs(src)); if (idx < 0) idx = 0;
      }
      openLb(imgs, idx);
    };
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(imgs, 0); } });
    var flag = $('.vid-flag', wrap), vi = imgs.findIndex(isVideo);
    if (flag && vi > -1) flag.addEventListener('click', function (e) { e.stopPropagation(); openLb(imgs, vi); });
  });

  /* logo fallback: a missing logo shows its initials */
  $$('.exp-logo img').forEach(function (img) {
    var fail = function () { var m = document.createElement('span'); m.className = 'exp-logo-mono'; m.textContent = (img.closest('.exp-org').querySelector('.exp-co') || {}).textContent ? img.closest('.exp-org').querySelector('.exp-co').textContent.replace(/[^A-Z]/g, '').slice(0, 3) : ''; img.replaceWith(m); };
    if (img.complete && !img.naturalWidth) fail(); else img.addEventListener('error', fail);
  });

  /* ── project cards: long write-ups fold to a few lines with a "Read more" toggle ── */
  $$('.proj-body').forEach(function (body) {
    var ps = $$(':scope > p', body); if (!ps.length) return;
    var desc = document.createElement('div'); desc.className = 'proj-desc';
    body.insertBefore(desc, ps[0]); ps.forEach(function (p) { desc.appendChild(p); });
    if (desc.scrollHeight <= desc.clientHeight + 4) return;               // short enough already
    body.classList.add('clamped');
    var t = document.createElement('button'); t.type = 'button'; t.className = 'proj-toggle'; t.setAttribute('aria-expanded', 'false');
    t.innerHTML = '<span class="more">Read more</span><span class="less">Show less</span>';
    desc.after(t);
    t.addEventListener('click', function () { var o = body.classList.toggle('open'); t.setAttribute('aria-expanded', o ? 'true' : 'false'); });
  });

  /* ── project filters ── */
  var filters = $('.filters');
  if (filters) {
    var cards = $$('.proj-card[data-cat]'), empty = $('.empty');
    var apply = function (cat) {
      var n = 0;
      cards.forEach(function (c) { var show = cat === 'all' || c.dataset.cat.split(' ').indexOf(cat) > -1; c.hidden = !show; if (show) n++; });
      $$('button', filters).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.filter === cat ? 'true' : 'false'); });
      if (empty) empty.hidden = n > 0;
    };
    filters.addEventListener('click', function (e) { var b = e.target.closest('button[data-filter]'); if (!b) return; apply(b.dataset.filter); history.replaceState(null, '', b.dataset.filter === 'all' ? location.pathname : '#' + b.dataset.filter); });
    var h = location.hash.slice(1); if (h && $('button[data-filter="' + h + '"]', filters)) apply(h);
  }

  /* ── running log (strava.json, refreshed nightly by GitHub Actions) ── */
  function countUp(el, target) {
    if (reduceMotion || !target) { el.textContent = Math.round(target); return; }
    var t0 = performance.now();
    (function tick(now) { var p = Math.min((now - t0) / 1200, 1); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); })(t0);
  }
  var runGrid = $('#run-grid');
  if (runGrid) {
    fetch('strava.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var targets = [];
      if (d.all) targets.push(['all-km', d.all.distance / 1000], ['all-runs', d.all.count], ['all-time', d.all.moving_time / 3600]);
      else { var row = $('#run-stats-all'); if (row) row.hidden = true; }
      if (d.ytd) targets.push(['ytd-km', d.ytd.distance / 1000], ['ytd-runs', d.ytd.count], ['ytd-time', d.ytd.moving_time / 3600]);
      var sec = $('#running');
      var go = function () { targets.forEach(function (t) { var el = document.getElementById(t[0]); if (el) countUp(el, t[1]); }); };
      if ('IntersectionObserver' in window && sec) { var io = new IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; })) { io.disconnect(); go(); } }, { threshold: .2 }); io.observe(sec); } else go();
      var acts = (d.activities || []).slice(0, 8);
      if (!acts.length) { runGrid.innerHTML = '<p class="run-placeholder">No runs logged yet.</p>'; return; }
      runGrid.classList.add('run-list');
      runGrid.innerHTML = '<div class="run-row head" aria-hidden="true"><span class="d">Date</span><span class="nm">Run</span><span class="v">Distance</span><span class="v t">Time</span><span class="v">Pace</span></div>' + acts.map(function (a) {
        var mins = Math.floor(a.moving_time / 60), h = Math.floor(mins / 60), m = mins % 60, pace = '–';
        if (a.distance > 0) { var ps = Math.round(a.moving_time / (a.distance / 1000)); pace = Math.floor(ps / 60) + ':' + String(ps % 60).padStart(2, '0') + ' /km'; }
        var name = String(a.name || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
        return '<div class="run-row"><span class="d">' + new Date(a.start_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) + '</span>' +
          '<span class="nm" data-no-i18n>' + name + '</span><span class="v">' + (a.distance / 1000).toFixed(2) + ' km</span>' +
          '<span class="v t">' + (h ? h + ' h ' + m + ' min' : m + ' min') + '</span><span class="v">' + pace + '</span></div>';
      }).join('');
    }).catch(function () { runGrid.innerHTML = '<p class="run-placeholder">Running stats are unavailable right now.</p>'; });
  }

  /* ── travel map: Leaflet loads only when the map is close to the screen ── */
  var mapEl = $('#travel-map');
  if (mapEl) {
    var startMap = function () {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
      var s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js'; s.onload = function () { var t = document.createElement('script'); t.src = 'travel-map.js'; document.head.appendChild(t); }; document.head.appendChild(s);
    };
    if (!('IntersectionObserver' in window)) startMap();
    else { var mio = new IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; })) { mio.disconnect(); startMap(); } }, { rootMargin: '900px 0px' }); mio.observe(mapEl); }
  }

  /* ── resume request form ──
     Sends the details to FORM_ENDPOINT (FormSubmit, which emails them to Chenyu; the address is behind the
     random key FormSubmit gave him, so it isn't in the page for scrapers). If it fails, the visitor gets a
     button to send the same details from their own email app. */
  var FORM_ENDPOINT = 'https://formsubmit.co/ajax/7b4b641aba93f567d44b6d2f79df5d20';
  var form = $('#req-form');
  if (form) {
    var status = $('.req-status', form), btn = $('button[type="submit"]', form), slow;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.elements._honey.value) return;                       // filled in by a bot
      if (!form.reportValidity()) return;
      var f = form.elements, data = {
        name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value.trim(), purpose: f.purpose.value, message: f.message.value.trim(),
        _subject: 'Resume request from ' + f.name.value.trim(), _template: 'table', _replyto: f.email.value.trim(), _captcha: 'false'
      };
      var mailHref = function () {
        var body = 'Name: ' + data.name + '\nEmail: ' + data.email + '\nRole and organization: ' + data.role + '\nWhat it is for: ' + data.purpose + '\n\n' + data.message;
        return 'mailto:info.chenyuli@gmail.com?subject=' + encodeURIComponent(data._subject) + '&body=' + encodeURIComponent(body);
      };
      btn.disabled = true; status.className = 'req-status'; status.textContent = 'Sending your request…';
      clearTimeout(slow); slow = setTimeout(function () { status.textContent = 'Still sending, this can take a few seconds…'; }, 3500);
      var ctl = 'AbortController' in window ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
      fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || String(j.success) === 'false') throw 0; }); })
        .then(function () { clearTimeout(timer); clearTimeout(slow); form.hidden = true; $('#req-done').hidden = false; })
        .catch(function () {
          clearTimeout(timer); clearTimeout(slow); btn.disabled = false; status.className = 'req-status err';
          status.textContent = 'That didn\'t go through. ';
          var a = document.createElement('a'); a.href = mailHref(); a.textContent = 'Send the same details by email instead';
          status.appendChild(a);
        });
    });
  }
})();
